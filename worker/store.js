// Inventory state: D1 for structured state, KV for image bytes. Both run on
// the Workers free plan without a payment method.
//
//   state 'live'    published payload (served verbatim as /data/inventory.json)
//   state 'draft'   the single pending change set (payload + report + diff)
//   state 'images'  { byCode: { CODE: { foto, flyer_es, flyer_en } }, byName: {...} }
//   versions        every published payload, for history and rollback
//   KV MEDIA        uploaded images, served at /assets/inventory/<file>
//
// Invariants enforced here (not by the UI or an AI client):
//   - nothing reaches 'live' without publish(draft_id) on the unchanged draft;
//   - a draft built on an older live version cannot be published (stale);
//   - read-modify-write uses the row's rev (compare-and-swap);
//   - each version number is published once (primary key, same transaction
//     as the live update).
//
// The free plan allows ~10 ms CPU per request, so workbook parsing happens in
// the browser (same worker/importer.js) and the server validates the payload.

import { CATEGORY_SLUGS, CONDITION_SLUGS, fold } from "./importer.js";
import { CODE_RE, IMAGE_KINDS, MAX_IMAGE_BYTES, codeFromImage, sha1Hex, sniffImage } from "./images.js";

export class ConflictError extends Error {}
export class InputError extends Error {}

export const PUBLIC_MEDIA_PREFIX = "assets/inventory/";
const LIST_LIMIT = 40;
const MAX_ITEMS = 20000;
const MAX_PAYLOAD_CHARS = 1_800_000; // D1 rows are limited to 2 MB
const now = () => new Date().toISOString();

export class InventoryStore {
  constructor(env, origin) {
    this.db = env.DB;
    this.media = env.MEDIA;
    this.assets = env.ASSETS;
    this.origin = origin;
  }

  // ---- Row helpers ---------------------------------------------------------

  async row(key) {
    return this.db.prepare("SELECT value, meta, rev FROM state WHERE key = ?").bind(key).first();
  }

  /** Insert (rev === null) or compare-and-swap update (rev = expected rev). */
  async put(key, value, meta, rev) {
    const v = typeof value === "string" ? value : JSON.stringify(value);
    if (v.length > MAX_PAYLOAD_CHARS) throw new InputError("The inventory is too large to store (over ~1.8 MB of JSON).");
    const m = JSON.stringify(meta || {});
    const res =
      rev === null
        ? await this.db
            .prepare("INSERT INTO state (key, value, meta, rev, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(key) DO NOTHING")
            .bind(key, v, m, now())
            .run()
        : await this.db
            .prepare("UPDATE state SET value = ?, meta = ?, rev = rev + 1, updated_at = ? WHERE key = ? AND rev = ?")
            .bind(v, m, now(), key, rev)
            .run();
    if (res.meta.changes !== 1) throw new ConflictError(`${key} changed while it was being updated; retry.`);
  }

  /** Read-modify-write a JSON row with retries on conflict. fn(value|null) -> [value, meta]. */
  async update(key, fn, attempts = 4) {
    for (let i = 0; ; i++) {
      const row = await this.row(key);
      const [value, meta] = await fn(row ? JSON.parse(row.value) : null);
      try {
        await this.put(key, value, meta, row ? row.rev : null);
        return value;
      } catch (err) {
        if (!(err instanceof ConflictError) || i >= attempts - 1) throw err;
      }
    }
  }

  // ---- Reads ---------------------------------------------------------------

  /** Published payload as text (for serving) — the committed file before the first publish. */
  async liveText() {
    const row = await this.db.prepare("SELECT value FROM state WHERE key = 'live'").first();
    if (row) return row.value;
    const res = await this.assets.fetch(new URL("/data/inventory.json", this.origin));
    return res.ok ? res.text() : '{"items":[]}';
  }

  async live() {
    const payload = JSON.parse(await this.liveText());
    payload.version ??= 0;
    return payload;
  }

  async liveMeta() {
    const row = await this.db.prepare("SELECT meta FROM state WHERE key = 'live'").first();
    if (row) return JSON.parse(row.meta);
    return summary(await this.live());
  }

  async draft() {
    const row = await this.row("draft");
    return row ? JSON.parse(row.value) : null;
  }

  async images() {
    const row = await this.row("images");
    if (row) return JSON.parse(row.value);
    // First use: adopt the images referenced by the committed inventory.
    const byCode = {};
    for (const it of (await this.live()).items || []) {
      const refs = Object.fromEntries(IMAGE_KINDS.filter((k) => it[k]).map((k) => [k, it[k]]));
      if (Object.keys(refs).length) byCode[it.id.toUpperCase()] = refs;
    }
    return { byCode, byName: {} };
  }

  async status() {
    const [live, draftRow] = await Promise.all([
      this.liveMeta(),
      this.db.prepare("SELECT meta FROM state WHERE key = 'draft'").first(),
    ]);
    const draft = draftRow ? JSON.parse(draftRow.meta) : null;
    if (draft) draft.stale = draft.base_version !== live.version;
    return { live, draft };
  }

  async versions() {
    const { results } = await this.db
      .prepare("SELECT version, published_at, published_by, count, source, summary FROM versions ORDER BY version DESC LIMIT 200")
      .all();
    return results;
  }

  // ---- Draft builders ------------------------------------------------------

  /**
   * Replace the draft with a workbook import built in the browser by
   * worker/importer.js. The payload is validated here; nothing is trusted
   * beyond its shape.
   */
  async importPayload({ payload, report, filename }, actor) {
    const items = validateItems(payload?.items);
    if (!items.length) throw new InputError("The workbook has no available items; no draft was created.");
    const live = await this.live();
    const previous = await this.row("draft");
    const draft = newDraft(live, items, actor, { kind: "workbook", filename: String(filename || "").slice(0, 120) });
    draft.report = sanitizeReport(report);
    if (previous) draft.report.warnings.unshift("Se reemplazó el borrador anterior; sus cambios no publicados se descartaron.");
    await this.saveDraft(draft, live, previous ? previous.rev : null);
    return describe(draft);
  }

  /** Apply typed edits to the draft (creating it from live if needed). All or nothing. */
  async editItems(ops, actor) {
    if (!Array.isArray(ops) || !ops.length) throw new InputError("No changes given.");
    return this.mutateDraft(actor, (d) => {
      applyOps(d.payload, ops);
      return { kind: "edit", count: ops.length };
    });
  }

  /** Start a draft from a previous version. Publishing it is the rollback. */
  async restoreVersion(version, actor) {
    const row = await this.db.prepare("SELECT payload FROM versions WHERE version = ?").bind(version).first();
    if (!row) throw new InputError(`Version ${version} does not exist.`);
    const live = await this.live();
    const previous = await this.row("draft");
    const draft = newDraft(live, JSON.parse(row.payload).items, actor, { kind: "restore", version });
    await this.saveDraft(draft, live, previous ? previous.rev : null);
    return describe(draft);
  }

  async discardDraft() {
    await this.db.prepare("DELETE FROM state WHERE key = 'draft'").run();
  }

  /** Publish the reviewed draft. Fails if it changed or live moved since. */
  async publish(draftId, actor) {
    const [live, row] = await Promise.all([this.liveMeta(), this.row("draft")]);
    if (!row) throw new ConflictError("There is no draft to publish.");
    const draft = JSON.parse(row.value);
    if (draft.id !== draftId) {
      throw new ConflictError("The draft changed since it was reviewed. Review the current draft and publish its id.");
    }
    if (draft.base_version !== live.version) {
      throw new ConflictError(
        `This draft was built on version ${draft.base_version}, but version ${live.version} was published since. Discard it and redo the change.`,
      );
    }
    const version = live.version + 1;
    const published = {
      generated_at: draft.payload.generated_at,
      sample: false,
      count: draft.payload.items.length,
      version,
      published_at: now(),
      published_by: actor,
      items: draft.payload.items,
    };
    const text = JSON.stringify(published);
    const meta = JSON.stringify(summary(published));
    const source = draft.sources
      .map((s) => s.kind + (s.filename ? `:${s.filename}` : s.version ? `:v${s.version}` : ""))
      .filter((s, i, all) => all.indexOf(s) === i)
      .join(", ")
      .slice(0, 300);
    try {
      // One transaction: the version row (unique) + the live row + clearing the draft we published.
      await this.db.batch([
        this.db
          .prepare("INSERT INTO versions (version, payload, published_at, published_by, count, source, summary) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(version, text, published.published_at, actor, published.count, source, draft.changes.summary),
        this.db
          .prepare(
            "INSERT INTO state (key, value, meta, rev, updated_at) VALUES ('live', ?, ?, 1, ?) " +
              "ON CONFLICT(key) DO UPDATE SET value = excluded.value, meta = excluded.meta, rev = state.rev + 1, updated_at = excluded.updated_at",
          )
          .bind(text, meta, published.published_at),
        this.db.prepare("DELETE FROM state WHERE key = 'draft' AND rev = ?").bind(row.rev),
      ]);
    } catch (err) {
      if (/UNIQUE|constraint/i.test(String(err?.message))) {
        throw new ConflictError(`Version ${version} was just published by someone else. Review the current state.`);
      }
      throw err;
    }
    return { version, count: published.count, changes: draft.changes };
  }

  // ---- Images --------------------------------------------------------------

  /**
   * Store an image and attach it to a product code in the draft. `code` may be
   * omitted when the filename or the image metadata carries it.
   */
  async attachImage({ bytes, filename = "", code, kind = "foto" }, actor) {
    if (!IMAGE_KINDS.includes(kind)) throw new InputError(`kind must be one of ${IMAGE_KINDS.join(", ")}.`);
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new InputError("Image is larger than 8 MB; resize it to ~1200 px first.");
    const type = sniffImage(bytes);
    if (!type) throw new InputError("Not a supported image (JPEG, PNG, WebP, AVIF or GIF).");
    code = String(code || /bo-\d{5}(?!\d)/i.exec(filename)?.[0] || codeFromImage(bytes) || "").trim().toUpperCase();
    if (!code) throw new InputError("Missing product code: give the BO-xxxxx code for this image.");
    if (!CODE_RE.test(code) && !/^ITEM-[0-9A-F]{8}$/.test(code)) throw new InputError(`'${code}' is not a product code (BO-00000).`);

    const name = `${fold(code)}-${kind.replace("_", "-")}-${(await sha1Hex(bytes)).slice(0, 10)}${type.ext}`;
    await this.media.put(name, bytes, { metadata: { contentType: type.mime, code, kind, uploaded_by: actor } });
    const path = PUBLIC_MEDIA_PREFIX + name;

    const seed = await this.images();
    await this.update("images", (current) => {
      const index = current || seed;
      index.byCode[code] = { ...index.byCode[code], [kind]: path };
      if (filename) index.byName[filename.toLowerCase().slice(0, 200)] = path;
      return [index, {}];
    });

    let attached = false;
    const draft = await this.mutateDraft(actor, (d) => {
      const item = d.payload.items.find((i) => i.id.toUpperCase() === code);
      if (item) {
        item[kind] = path;
        attached = true;
      }
      return { kind: "image", code, image: kind };
    });
    return {
      code,
      kind,
      url: new URL("/" + path, this.origin).href,
      attached_to_draft: attached,
      note: attached
        ? "Attached in the draft; publish to show it on the site."
        : `No item ${code} is in the inventory yet. The image is saved and will attach when a workbook with that code is imported.`,
      draft,
    };
  }

  async removeImage(code, kind, actor) {
    code = String(code || "").toUpperCase();
    if (!IMAGE_KINDS.includes(kind)) throw new InputError(`kind must be one of ${IMAGE_KINDS.join(", ")}.`);
    const seed = await this.images();
    await this.update("images", (current) => {
      const index = current || seed;
      if (index.byCode[code]) delete index.byCode[code][kind];
      return [index, {}];
    });
    return this.mutateDraft(actor, (d) => {
      const item = d.payload.items.find((i) => i.id.toUpperCase() === code);
      if (item) delete item[kind];
      return { kind: "image-removed", code, image: kind };
    });
  }

  /** Serve an uploaded image from KV, or null when it isn't there. */
  async mediaResponse(name) {
    const { value, metadata } = await this.media.getWithMetadata(name, { type: "stream", cacheTtl: 86400 });
    if (!value) return null;
    return new Response(value, {
      headers: { "content-type": metadata?.contentType || "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" },
    });
  }

  // ---- Internals -----------------------------------------------------------

  async mutateDraft(actor, fn) {
    const live = await this.live();
    for (let i = 0; ; i++) {
      const row = await this.row("draft");
      const d = row ? JSON.parse(row.value) : newDraft(live, live.items, actor, null);
      const source = fn(d);
      touch(d, actor, source);
      try {
        await this.saveDraft(d, live, row ? row.rev : null);
        return describe(d);
      } catch (err) {
        if (!(err instanceof ConflictError) || i >= 3) throw err;
      }
    }
  }

  async saveDraft(draft, live, rev) {
    draft.changes = diff(live, draft.payload);
    draft.count = draft.payload.items.length;
    if (rev === null) {
      // Replace semantics for imports/restores: an existing draft is overwritten.
      await this.db.prepare("DELETE FROM state WHERE key = 'draft'").run();
    }
    await this.put("draft", draft, describe(draft), rev);
  }
}

// ---- Pure helpers ------------------------------------------------------------

function describe(draft) {
  const { payload, ...rest } = draft;
  return rest;
}

function newDraft(live, items, actor, source) {
  const t = now();
  return {
    id: crypto.randomUUID(),
    base_version: live.version ?? 0,
    created_at: t,
    updated_at: t,
    created_by: actor,
    sources: source ? [source] : [],
    payload: { generated_at: t, items: structuredClone(items) },
    report: null,
  };
}

/** Every mutation gets a new id, so a publish can only target what was reviewed. */
function touch(draft, actor, source) {
  draft.id = crypto.randomUUID();
  draft.updated_at = now();
  draft.updated_by = actor;
  draft.sources = [...draft.sources, source].slice(-50);
  draft.payload.generated_at = draft.updated_at;
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const nonNegInt = (v, field) => {
  if (!Number.isInteger(v) || v < 0 || v > 1e9) throw new InputError(`${field} must be a whole number ≥ 0.`);
  return v;
};
const imagePath = (v) =>
  typeof v === "string" && (/^assets\/inventory\/[A-Za-z0-9._-]+$/.test(v) || /^https:\/\/[^\s"'<>]+$/.test(v)) ? v : null;

/** Validate and normalize items coming from a client-side import. */
function validateItems(items) {
  if (!Array.isArray(items)) throw new InputError("payload.items must be a list.");
  if (items.length > MAX_ITEMS) throw new InputError(`Too many items (max ${MAX_ITEMS}).`);
  const seen = new Set();
  return items.map((raw, i) => {
    const where = `item ${i + 1}`;
    const id = str(raw?.id, 40);
    if (!id) throw new InputError(`${where}: missing code.`);
    if (seen.has(id.toUpperCase())) throw new InputError(`${where}: duplicate code ${id}.`);
    seen.add(id.toUpperCase());
    const name = str(raw.name_es, 300);
    if (!name) throw new InputError(`${where} (${id}): missing name.`);
    if (!CATEGORY_SLUGS.includes(raw.category)) throw new InputError(`${where} (${id}): unknown category.`);
    const item = { id, name_es: name, category: raw.category, qty: nonNegInt(raw.qty, `${id} qty`) };
    if (item.qty === 0) throw new InputError(`${where} (${id}): quantity 0 items are not published.`);
    for (const key of ["name_en", "detail_es", "detail_en"]) {
      const v = str(raw[key], key === "name_en" ? 300 : 600);
      if (v) item[key] = v;
    }
    if (raw.condition != null) {
      if (!CONDITION_SLUGS.includes(raw.condition)) throw new InputError(`${where} (${id}): unknown condition.`);
      item.condition = raw.condition;
    }
    if (raw.price_crc != null) item.price_crc = nonNegInt(raw.price_crc, `${id} price`);
    for (const key of IMAGE_KINDS) {
      if (raw[key] == null) continue;
      const v = imagePath(raw[key]);
      if (!v) throw new InputError(`${where} (${id}): invalid ${key} path.`);
      item[key] = v;
    }
    return item;
  });
}

function sanitizeReport(report) {
  const list = (v) => (Array.isArray(v) ? v.slice(0, 500).map((x) => String(x).slice(0, 300)) : []);
  return {
    sheet: str(report?.sheet, 80),
    rows_read: Number.isInteger(report?.rows_read) ? report.rows_read : null,
    skipped: list(report?.skipped),
    warnings: list(report?.warnings),
  };
}

function applyOps(payload, ops) {
  if (ops.length > 500) throw new InputError("Too many changes in one request (max 500).");
  const byId = new Map(payload.items.map((it) => [it.id.toUpperCase(), it]));
  const find = (id) => {
    const it = byId.get(String(id || "").toUpperCase());
    if (!it) throw new InputError(`No item with code '${id}' in the inventory.`);
    return it;
  };
  const removed = new Set();
  for (const op of ops) {
    switch (op?.op) {
      case "set_price": {
        const it = find(op.id);
        if (op.price_crc === null) delete it.price_crc;
        else it.price_crc = nonNegInt(op.price_crc, "price_crc");
        break;
      }
      case "set_quantity": {
        const it = find(op.id);
        const qty = nonNegInt(op.qty, "qty");
        if (qty === 0) removed.add(it.id);
        else it.qty = qty;
        break;
      }
      case "remove":
        removed.add(find(op.id).id);
        break;
      case "set_fields": {
        const it = find(op.id);
        for (const key of ["name_es", "name_en", "detail_es", "detail_en"]) {
          if (op[key] === undefined) continue;
          const v = op[key] === null ? "" : str(String(op[key]), 600);
          if (key === "name_es" && !v) throw new InputError("name_es cannot be empty.");
          if (v) it[key] = v;
          else delete it[key];
        }
        if (op.category !== undefined) {
          if (!CATEGORY_SLUGS.includes(op.category)) throw new InputError(`category must be one of ${CATEGORY_SLUGS.join(", ")}.`);
          it.category = op.category;
        }
        if (op.condition !== undefined) {
          if (op.condition === null) delete it.condition;
          else if (!CONDITION_SLUGS.includes(op.condition)) throw new InputError(`condition must be one of ${CONDITION_SLUGS.join(", ")}.`);
          else it.condition = op.condition;
        }
        break;
      }
      case "add": {
        const src = op.item || {};
        const id = str(String(src.id || ""), 20).toUpperCase();
        if (!CODE_RE.test(id)) throw new InputError("New items need a code like BO-01234.");
        if (byId.has(id)) throw new InputError(`Item ${id} already exists; use set_fields / set_price.`);
        const name = str(String(src.name_es || ""), 300);
        if (!name) throw new InputError("New items need name_es.");
        const item = { id, name_es: name, category: src.category || "otros", qty: nonNegInt(src.qty ?? 1, "qty") || 1 };
        if (!CATEGORY_SLUGS.includes(item.category)) throw new InputError(`category must be one of ${CATEGORY_SLUGS.join(", ")}.`);
        if (src.name_en) item.name_en = str(String(src.name_en), 300);
        if (src.price_crc != null) item.price_crc = nonNegInt(src.price_crc, "price_crc");
        if (src.condition) {
          if (!CONDITION_SLUGS.includes(src.condition)) throw new InputError(`condition must be one of ${CONDITION_SLUGS.join(", ")}.`);
          item.condition = src.condition;
        }
        payload.items.push(item);
        byId.set(id, item);
        break;
      }
      default:
        throw new InputError(`Unknown operation '${op?.op}'. Use set_price, set_quantity, remove, set_fields or add.`);
    }
  }
  if (removed.size) payload.items = payload.items.filter((it) => !removed.has(it.id));
}

function summary(payload) {
  return {
    version: payload.version ?? 0,
    published_at: payload.published_at ?? null,
    published_by: payload.published_by ?? "git",
    count: payload.items?.length ?? 0,
    with_images: (payload.items || []).filter((i) => i.foto || i.flyer_es || i.flyer_en).length,
  };
}

/** What publishing `next` would change relative to `prev`. */
export function diff(prev, next) {
  const before = new Map((prev.items || []).map((i) => [i.id, i]));
  const after = new Map((next.items || []).map((i) => [i.id, i]));
  const short = (i) => i.name_es.slice(0, 80);
  const added = [], removed = [], price = [], qty = [], images = [], details = [];
  for (const [id, n] of after) {
    const p = before.get(id);
    if (!p) { added.push({ id, name: short(n), price_crc: n.price_crc ?? null, qty: n.qty }); continue; }
    if ((p.price_crc ?? null) !== (n.price_crc ?? null)) price.push({ id, name: short(n), from: p.price_crc ?? null, to: n.price_crc ?? null });
    if (p.qty !== n.qty) qty.push({ id, name: short(n), from: p.qty, to: n.qty });
    if (IMAGE_KINDS.some((k) => (p[k] ?? null) !== (n[k] ?? null))) images.push({ id, name: short(n) });
    if (["name_es", "name_en", "detail_es", "detail_en", "category", "condition"].some((k) => (p[k] ?? null) !== (n[k] ?? null))) details.push({ id, name: short(n) });
  }
  for (const [id, p] of before) if (!after.has(id)) removed.push({ id, name: short(p), price_crc: p.price_crc ?? null, qty: p.qty });
  const cap = (list) => ({ total: list.length, items: list.slice(0, LIST_LIMIT) });
  const counts = { added: added.length, removed: removed.length, price: price.length, qty: qty.length, images: images.length, details: details.length };
  return {
    summary: Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${k}:${n}`).join(" ") || "no changes",
    added: cap(added),
    removed: cap(removed),
    price_changed: cap(price),
    qty_changed: cap(qty),
    images_changed: cap(images),
    details_changed: cap(details),
  };
}
