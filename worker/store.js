// Inventory state in R2.
//
//   live.json              published payload + { version, published_at, published_by }
//   versions/000042.json   every published payload, for history and rollback
//   draft.json             the single pending change set (payload + report)
//   images/index.json      { byCode: { CODE: { foto, flyer_es, flyer_en } }, byName: {...} }
//   media/<file>           uploaded images, served at /assets/inventory/<file>
//
// Invariants enforced here (not by the UI or the AI client):
//   - nothing reaches live.json without publish(draft_id) on an unchanged draft;
//   - a draft built on an older live version cannot be published (stale);
//   - every write that depends on what it read is conditional on the R2 etag.

import { buildInventory, CATEGORY_SLUGS, CONDITION_SLUGS, fold, ImportError, readWorkbook } from "./importer.js";
import { CODE_RE, IMAGE_KINDS, MAX_IMAGE_BYTES, codeFromImage, sha1Hex, sniffImage } from "./images.js";

export class ConflictError extends Error {}
export class InputError extends Error {}
export { ImportError };

const LIVE = "live.json";
const DRAFT = "draft.json";
const INDEX = "images/index.json";
const MEDIA_PREFIX = "media/";
export const PUBLIC_MEDIA_PREFIX = "assets/inventory/";
const versionKey = (v) => `versions/${String(v).padStart(6, "0")}.json`;
const LIST_LIMIT = 40;

const now = () => new Date().toISOString();

async function getJson(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return { value: null, etag: null };
  return { value: await obj.json(), etag: obj.etag };
}

async function putJson(bucket, key, value, etag) {
  const options = { httpMetadata: { contentType: "application/json; charset=utf-8" } };
  // etag === null means "must not exist yet"; undefined means unconditional.
  if (etag) options.onlyIf = { etagMatches: etag };
  else if (etag === null) options.onlyIf = { etagDoesNotMatch: "*" };
  const res = await bucket.put(key, JSON.stringify(value), options);
  if (res === null) throw new ConflictError(`${key} changed while it was being updated; retry.`);
  return res.etag;
}

/** Read-modify-write with optimistic concurrency, retried on conflict. */
async function update(bucket, key, fn, attempts = 4) {
  for (let i = 0; ; i++) {
    const { value, etag } = await getJson(bucket, key);
    const next = await fn(value);
    try {
      await putJson(bucket, key, next, etag);
      return next;
    } catch (err) {
      if (!(err instanceof ConflictError) || i >= attempts - 1) throw err;
    }
  }
}

export class InventoryStore {
  constructor(env, origin) {
    this.bucket = env.STORE;
    this.assets = env.ASSETS;
    this.origin = origin;
  }

  // ---- Reads ---------------------------------------------------------------

  /** Published inventory; before the first publish, the payload committed to git. */
  async live() {
    const { value, etag } = await getJson(this.bucket, LIVE);
    if (value) return { payload: value, etag };
    const res = await this.assets.fetch(new URL("/data/inventory.json", this.origin));
    const payload = res.ok ? await res.json() : { items: [] };
    return { payload: { ...payload, version: 0, published_at: null, published_by: "git" }, etag: null };
  }

  async draft() {
    return (await getJson(this.bucket, DRAFT)).value;
  }

  async images() {
    const { value } = await getJson(this.bucket, INDEX);
    if (value) return value;
    // First use: adopt the images already referenced by the committed inventory.
    const { payload } = await this.live();
    const byCode = {};
    for (const it of payload.items || []) {
      const refs = Object.fromEntries(IMAGE_KINDS.filter((k) => it[k]).map((k) => [k, it[k]]));
      if (Object.keys(refs).length) byCode[it.id.toUpperCase()] = refs;
    }
    return { byCode, byName: {} };
  }

  async status() {
    const [{ payload }, draft] = await Promise.all([this.live(), this.draft()]);
    return {
      live: summary(payload),
      draft: draft && this.describeDraft(draft, payload),
    };
  }

  describeDraft(draft, livePayload) {
    return {
      id: draft.id,
      base_version: draft.base_version,
      stale: draft.base_version !== (livePayload.version ?? 0),
      created_at: draft.created_at,
      updated_at: draft.updated_at,
      created_by: draft.created_by,
      sources: draft.sources,
      count: draft.payload.items.length,
      import_report: draft.report,
      changes: diff(livePayload, draft.payload),
    };
  }

  async versions() {
    const out = [];
    let cursor;
    do {
      const page = await this.bucket.list({ prefix: "versions/", cursor, include: ["customMetadata"] });
      for (const o of page.objects) out.push({ version: Number(o.key.slice(9, 15)), ...o.customMetadata });
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return out.sort((a, b) => b.version - a.version);
  }

  // ---- Draft builders ------------------------------------------------------

  /** Replace the draft with the inventory read from a workbook. */
  async importWorkbook(bytes, filename, actor) {
    const [{ payload: live }, images] = await Promise.all([this.live(), this.images()]);
    const { payload, report } = await buildInventory(readWorkbook(bytes, filename), { images });
    if (!payload.items.length) throw new ImportError("La hoja no tiene ningún artículo disponible; no se creó el borrador.");
    const previous = await this.draft();
    const draft = newDraft(live, payload, actor, { kind: "workbook", filename });
    draft.report = report;
    if (previous) {
      report.warnings.unshift(
        `Se reemplazó el borrador anterior (${previous.sources.map((s) => s.kind).join(", ")}); sus cambios no publicados se descartaron.`,
      );
    }
    await putJson(this.bucket, DRAFT, draft);
    return this.describeDraft(draft, live);
  }

  /** Apply typed edits to the draft (creating it from live if needed). All or nothing. */
  async editItems(ops, actor) {
    if (!Array.isArray(ops) || !ops.length) throw new InputError("No changes given.");
    const { payload: live } = await this.live();
    const draft = await update(this.bucket, DRAFT, (current) => {
      const d = current ? structuredClone(current) : newDraft(live, live, actor, null);
      applyOps(d.payload, ops);
      touch(d, actor, { kind: "edit", count: ops.length });
      return d;
    });
    return this.describeDraft(draft, live);
  }

  /** Start a draft from a previous version. Publishing it is the rollback. */
  async restoreVersion(version, actor) {
    const { value } = await getJson(this.bucket, versionKey(version));
    if (!value) throw new InputError(`Version ${version} does not exist.`);
    const { payload: live } = await this.live();
    const { version: _v, published_at, published_by, ...payload } = value;
    const draft = newDraft(live, payload, actor, { kind: "restore", version });
    await putJson(this.bucket, DRAFT, draft);
    return this.describeDraft(draft, live);
  }

  async discardDraft() {
    await this.bucket.delete(DRAFT);
  }

  /** Publish the reviewed draft. Fails if it changed or live moved since. */
  async publish(draftId, actor) {
    const [{ payload: live, etag: liveEtag }, { value: draft, etag: draftEtag }] = await Promise.all([
      this.live(),
      getJson(this.bucket, DRAFT),
    ]);
    if (!draft) throw new ConflictError("There is no draft to publish.");
    if (draft.id !== draftId) {
      throw new ConflictError("The draft changed since it was reviewed. Review the current draft and publish its id.");
    }
    const liveVersion = live.version ?? 0;
    if (draft.base_version !== liveVersion) {
      throw new ConflictError(
        `This draft was built on version ${draft.base_version}, but version ${liveVersion} was published since. Discard it and redo the change.`,
      );
    }
    const version = liveVersion + 1;
    const published = {
      ...draft.payload,
      count: draft.payload.items.length,
      generated_at: draft.payload.generated_at,
      version,
      published_at: now(),
      published_by: actor,
    };
    const changes = diff(live, draft.payload);
    // Winning the conditional write on live.json is what makes this publish
    // version N; the history copy is written only by the winner.
    await putJson(this.bucket, LIVE, published, liveEtag);
    await this.bucket.put(versionKey(version), JSON.stringify(published), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        published_at: published.published_at,
        published_by: actor,
        count: String(published.count),
        source: draft.sources
          .map((s) => s.kind + (s.filename ? `:${s.filename}` : s.version ? `:v${s.version}` : ""))
          .join(", ")
          .slice(0, 200),
        summary: changes.summary,
      },
    });
    // Only remove the draft we published; a newer one stays.
    const after = await this.bucket.head(DRAFT);
    if (after?.etag === draftEtag) await this.bucket.delete(DRAFT);
    return { version, count: published.count, changes };
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
    code = (code || /bo-\d{5}(?!\d)/i.exec(filename)?.[0] || codeFromImage(bytes) || "").trim().toUpperCase();
    if (!code) throw new InputError("Missing product code: give the BO-xxxxx code for this image.");

    const { payload: live } = await this.live();
    const known = (live.items || []).some((i) => i.id.toUpperCase() === code);
    const draftNow = await this.draft();
    const inDraft = draftNow?.payload.items.some((i) => i.id.toUpperCase() === code);
    if (!CODE_RE.test(code) && !known && !inDraft) throw new InputError(`Unknown product code '${code}'.`);

    const name = `${fold(code)}-${kind.replace("_", "-")}-${(await sha1Hex(bytes)).slice(0, 10)}${type.ext}`;
    await this.bucket.put(MEDIA_PREFIX + name, bytes, {
      httpMetadata: { contentType: type.mime, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { code, kind, original_name: filename.slice(0, 200), uploaded_by: actor },
    });
    const path = PUBLIC_MEDIA_PREFIX + name;

    const seed = await this.images();
    await update(this.bucket, INDEX, (current) => {
      const index = current || seed;
      index.byCode[code] = { ...index.byCode[code], [kind]: path };
      if (filename) index.byName[filename.toLowerCase()] = path;
      return index;
    });

    let attached = false;
    const draft = await update(this.bucket, DRAFT, (current) => {
      const d = current ? structuredClone(current) : newDraft(live, live, actor, null);
      const item = d.payload.items.find((i) => i.id.toUpperCase() === code);
      if (item) {
        item[kind] = path;
        attached = true;
      }
      touch(d, actor, { kind: "image", code, image: kind });
      return d;
    });
    return {
      code,
      kind,
      url: new URL("/" + path, this.origin).href,
      attached_to_draft: attached,
      note: attached
        ? "Attached in the draft; publish to show it on the site."
        : `No item ${code} is in the inventory yet. The image is saved and will attach when a workbook with that code is imported.`,
      draft: this.describeDraft(draft, live),
    };
  }

  async removeImage(code, kind, actor) {
    code = String(code || "").toUpperCase();
    if (!IMAGE_KINDS.includes(kind)) throw new InputError(`kind must be one of ${IMAGE_KINDS.join(", ")}.`);
    const seed = await this.images();
    await update(this.bucket, INDEX, (current) => {
      const index = current || seed;
      if (index.byCode[code]) delete index.byCode[code][kind];
      return index;
    });
    const { payload: live } = await this.live();
    const draft = await update(this.bucket, DRAFT, (current) => {
      const d = current ? structuredClone(current) : newDraft(live, live, actor, null);
      const item = d.payload.items.find((i) => i.id.toUpperCase() === code);
      if (item) delete item[kind];
      touch(d, actor, { kind: "image-removed", code, image: kind });
      return d;
    });
    return this.describeDraft(draft, live);
  }

  /** Serve an uploaded image, or null when R2 doesn't have it. */
  async media(name, request) {
    const obj = await this.bucket.get(MEDIA_PREFIX + name, { onlyIf: request.headers });
    if (!obj) return null;
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
    return new Response(obj.body, { headers });
  }
}

// ---- Pure helpers ------------------------------------------------------------

function newDraft(live, payload, actor, source) {
  const t = now();
  return {
    id: crypto.randomUUID(),
    base_version: live.version ?? 0,
    created_at: t,
    updated_at: t,
    created_by: actor,
    sources: source ? [source] : [],
    payload: {
      generated_at: payload.generated_at || t,
      sample: Boolean(payload.sample),
      count: payload.items.length,
      items: structuredClone(payload.items),
    },
    report: null,
  };
}

/** Every mutation gets a new id, so a publish can only target what was reviewed. */
function touch(draft, actor, source) {
  draft.id = crypto.randomUUID();
  draft.updated_at = now();
  draft.updated_by = actor;
  draft.sources = [...draft.sources, source].slice(-50);
  draft.payload.count = draft.payload.items.length;
  draft.payload.generated_at = draft.updated_at;
}

const nonNegInt = (v, field) => {
  if (!Number.isInteger(v) || v < 0) throw new InputError(`${field} must be a whole number ≥ 0.`);
  return v;
};

function applyOps(payload, ops) {
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
          const v = op[key] === null ? "" : String(op[key]).trim();
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
        const id = String(src.id || "").trim().toUpperCase();
        if (!CODE_RE.test(id)) throw new InputError("New items need a code like BO-01234.");
        if (byId.has(id)) throw new InputError(`Item ${id} already exists; use set_fields / set_price.`);
        const name = String(src.name_es || "").trim();
        if (!name) throw new InputError("New items need name_es.");
        const item = { id, name_es: name, category: src.category || "otros", qty: nonNegInt(src.qty ?? 1, "qty") || 1 };
        if (!CATEGORY_SLUGS.includes(item.category)) throw new InputError(`category must be one of ${CATEGORY_SLUGS.join(", ")}.`);
        if (src.name_en) item.name_en = String(src.name_en).trim();
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
    published_by: payload.published_by ?? null,
    count: payload.items?.length ?? 0,
    with_images: (payload.items || []).filter((i) => i.foto || i.flyer_es || i.flyer_en).length,
  };
}

/** What publishing `next` would change relative to `prev`. */
export function diff(prev, next) {
  const before = new Map((prev.items || []).map((i) => [i.id, i]));
  const after = new Map((next.items || []).map((i) => [i.id, i]));
  const brief = (i) => ({ id: i.id, name: i.name_es.slice(0, 80), price_crc: i.price_crc ?? null, qty: i.qty });
  const added = [], removed = [], price = [], qty = [], images = [], details = [];
  for (const [id, n] of after) {
    const p = before.get(id);
    if (!p) { added.push(brief(n)); continue; }
    if ((p.price_crc ?? null) !== (n.price_crc ?? null)) price.push({ id, name: n.name_es.slice(0, 80), from: p.price_crc ?? null, to: n.price_crc ?? null });
    if (p.qty !== n.qty) qty.push({ id, name: n.name_es.slice(0, 80), from: p.qty, to: n.qty });
    if (IMAGE_KINDS.some((k) => (p[k] ?? null) !== (n[k] ?? null))) images.push({ id, name: n.name_es.slice(0, 80), ...Object.fromEntries(IMAGE_KINDS.map((k) => [k, n[k] ?? null])) });
    if (["name_es", "name_en", "detail_es", "detail_en", "category", "condition"].some((k) => (p[k] ?? null) !== (n[k] ?? null))) details.push({ id, name: n.name_es.slice(0, 80) });
  }
  for (const [id, p] of before) if (!after.has(id)) removed.push(brief(p));
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
