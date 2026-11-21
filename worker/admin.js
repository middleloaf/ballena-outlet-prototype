// Admin API (/api/admin/*). Callers are already authenticated (see auth.js)
// and same-origin checked (index.js); every route maps to one InventoryStore
// operation, which owns the invariants.

import { ConflictError, InputError, InventoryStore } from "./store.js";

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new InputError("Expected a JSON body.");
  }
}

async function upload(request, field, maxBytes) {
  const form = await request.formData().catch(() => {
    throw new InputError("Expected a multipart/form-data upload.");
  });
  const file = form.get(field);
  if (!file || typeof file === "string") throw new InputError(`Missing file field '${field}'.`);
  if (file.size > maxBytes) throw new InputError(`File is larger than ${Math.round(maxBytes / 1048576)} MB.`);
  return { form, file, bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** Admin search over the draft (if any) or the published inventory. */
async function items(store, params) {
  const draft = await store.draft();
  const source = draft ? draft.payload : await store.live();
  const q = (params.get("q") || "").trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const found = source.items.filter((it) => {
    const hay = `${it.id} ${it.name_es} ${it.name_en || ""}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  return { from: draft ? "draft" : "live", total: found.length, items: found.slice(0, 50) };
}

export async function handleAdmin(request, env, origin, admin) {
  const { pathname, searchParams } = new URL(request.url);
  const route = `${request.method} ${pathname.replace(/^\/api\/admin/, "")}`;

  if (!env.DB || !env.MEDIA) return reply({ error: "storage_not_configured" }, 503);
  const store = new InventoryStore(env, origin);

  try {
    switch (route) {
      case "GET /whoami":
        return reply({ email: admin });
      case "GET /status":
        return reply(await store.status());
      case "GET /items":
        return reply(await items(store, searchParams));
      case "GET /versions":
        return reply({ versions: await store.versions() });
      case "GET /images":
        return reply(await store.images());
      case "POST /import":
        // The workbook is parsed in the browser by worker/importer.js; the
        // server validates the resulting payload (see store.importPayload).
        return reply({ draft: await store.importPayload(await body(request), admin) });
      case "POST /edits": {
        const { ops } = await body(request);
        return reply({ draft: await store.editItems(ops, admin) });
      }
      case "POST /images": {
        const { form, file, bytes } = await upload(request, "file", 9 * 1024 * 1024);
        return reply(
          await store.attachImage(
            { bytes, filename: file.name || "", code: form.get("code") || "", kind: form.get("kind") || "foto" },
            admin,
          ),
        );
      }
      case "POST /images/remove": {
        const { code, kind } = await body(request);
        return reply({ draft: await store.removeImage(code, kind, admin) });
      }
      case "POST /restore": {
        const { version } = await body(request);
        return reply({ draft: await store.restoreVersion(Number(version), admin) });
      }
      case "POST /publish": {
        const { draft_id } = await body(request);
        return reply(await store.publish(draft_id, admin));
      }
      case "POST /draft/discard":
        await store.discardDraft();
        return reply({ ok: true });
      default:
        return reply({ error: "not_found" }, 404);
    }
  } catch (err) {
    if (err instanceof ConflictError) return reply({ error: "conflict", message: err.message }, 409);
    if (err instanceof InputError) return reply({ error: "invalid", message: err.message }, 400);
    console.error(err);
    return reply({ error: "internal_error" }, 500);
  }
}
