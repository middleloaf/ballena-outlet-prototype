// Ballena Outlet Worker.
//
// Static pages and images are served by the asset store (see wrangler.jsonc);
// this script only runs for /api/*. The API is read-only and built on the same
// data/inventory.json the site renders, so the WhatsApp bot (Kapso) and the
// website can never disagree about stock or prices.

const CATEGORIES = {
  electrodomesticos: { es: "Electrodomésticos", en: "Appliances" },
  hogar: { es: "Hogar", en: "Home" },
  mejoras_hogar: { es: "Mejoras del hogar", en: "Home improvement" },
  textiles: { es: "Textiles", en: "Textiles" },
  juguetes: { es: "Juguetes", en: "Toys" },
  electronica: { es: "Electrónica", en: "Electronics" },
  belleza: { es: "Belleza", en: "Beauty" },
  herramientas: { es: "Herramientas", en: "Tools" },
  ropa: { es: "Ropa", en: "Clothing" },
  otros: { es: "Otros", en: "Other" },
};

const STORE = {
  name: "Ballena Outlet",
  address:
    "Plaza La Perla del Pacífico, contigua a Servicentro Ballena, en los altos de la Farmacia Ballena, Uvita, Costa Rica",
  whatsapp: "+50663132925",
  whatsapp_link: "https://wa.me/50663132925",
  email: "ballena.outletafacturacion@hotmail.com",
  hours: {
    es: "Lunes, martes y jueves: 9:00 a. m. – 6:00 p. m. Miércoles, viernes y sábado: 10:00 a. m. – 7:00 p. m. Cerrado de 12:00 m. d. a 1:00 p. m. (almuerzo). Domingo cerrado.",
    en: "Monday, Tuesday and Thursday: 9:00 a.m. – 6:00 p.m. Wednesday, Friday and Saturday: 10:00 a.m. – 7:00 p.m. Closed 12:00–1:00 p.m. for lunch. Closed Sunday.",
  },
  sinpe_movil: "+50661556974",
  payment:
    "In store, or by SINPE Móvil to 6155-6974. Customers must confirm the purchase on WhatsApp before making any deposit.",
  purchase:
    "No online checkout. Items are sold in store (pickup) and the store can ship from the shop. Availability is confirmed by WhatsApp or in store.",
  pricing_note:
    "price_crc is the tag price in Costa Rican colones. Register discounts are applied in store and are not reflected here.",
};

const MAX_LIMIT = 50;

let cached; // { key, data } — an isolate never outlives a deploy, so this is safe.

async function loadInventory(env, origin) {
  const res = await env.ASSETS.fetch(new URL("/data/inventory.json", origin));
  if (!res.ok) throw new Error(`inventory.json: HTTP ${res.status}`);
  const etag = res.headers.get("etag") || "";
  if (cached && etag && cached.key === etag) return cached.data;
  const raw = await res.json();
  const items = raw.items.map((it) => ({
    ...it,
    _words: tokens([it.id, it.name_es, it.name_en, it.detalle_es, it.detalle_en].filter(Boolean).join(" ")),
  }));
  const data = { generated_at: raw.generated_at, sample: raw.sample, items };
  cached = { key: etag, data };
  return data;
}

function normalize(s) {
  return String(s)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function tokens(q) {
  return normalize(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function publicItem(it, origin, lang) {
  const image = it.photo || (lang === "en" ? it.flyer_en || it.flyer_es : it.flyer_es || it.flyer_en);
  const cat = CATEGORIES[it.category] || CATEGORIES.otros;
  return {
    id: it.id,
    name: (lang === "en" ? it.name_en || it.name_es : it.name_es) ?? null,
    name_es: it.name_es ?? null,
    name_en: it.name_en ?? null,
    detail: (lang === "en" ? it.detalle_en || it.detalle_es : it.detalle_es) ?? null,
    category: it.category,
    category_label: cat[lang] || cat.es,
    condition: it.condition ?? null,
    price_crc: it.price_crc ?? null,
    quantity: it.qty ?? 1,
    image_url: image ? new URL(image, origin).href : null,
  };
}

function search(items, params) {
  const q = params.get("q") || "";
  const category = params.get("category");
  const min = num(params.get("min_price"));
  const max = num(params.get("max_price"));
  const terms = tokens(q);

  let pool = items.filter(
    (it) =>
      (!category || it.category === category) &&
      (min == null || (it.price_crc != null && it.price_crc >= min)) &&
      (max == null || (it.price_crc != null && it.price_crc <= max)),
  );

  if (!terms.length) return { matched: "all", results: pool };

  const scored = pool
    // Word-prefix match: "lego" hits "LEGO", "blend" hits "Blender", but
    // "ice" does not hit "Liquorice".
    .map((it) => ({ it, hits: terms.filter((t) => it._words.some((w) => w.startsWith(t))).length }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const all = scored.filter((s) => s.hits === terms.length);
  // Prefer items containing every term; fall back to partial matches so a
  // multi-word query never returns nothing when some words do match.
  return all.length
    ? { matched: "all_terms", results: all.map((s) => s.it) }
    : { matched: "some_terms", results: scored.map((s) => s.it) };
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=60",
      ...extra,
    },
  });
}

function openapi(origin) {
  const lang = { name: "lang", in: "query", schema: { type: "string", enum: ["es", "en"], default: "es" } };
  return {
    openapi: "3.1.0",
    info: {
      title: "Ballena Outlet inventory",
      version: "1.0.0",
      description:
        "Read-only live inventory of Ballena Outlet, a liquidation store in Uvita, Costa Rica. Product names are mostly in English (U.S. retail listings), so search with English keywords even when the customer writes in Spanish (e.g. 'licuadora' -> 'blender').",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/inventory/search": {
        get: {
          operationId: "searchInventory",
          summary: "Search items currently in stock",
          description:
            "Returns in-stock items matching keywords, category and price range. Use English product keywords. Prices are tag prices in CRC.",
          parameters: [
            { name: "q", in: "query", description: "Keywords, preferably English (e.g. 'lego', 'air fryer').", schema: { type: "string" } },
            { name: "category", in: "query", schema: { type: "string", enum: Object.keys(CATEGORIES) } },
            { name: "min_price", in: "query", description: "Minimum price in CRC.", schema: { type: "integer" } },
            { name: "max_price", in: "query", description: "Maximum price in CRC.", schema: { type: "integer" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 10, maximum: MAX_LIMIT } },
            lang,
          ],
          responses: { 200: { description: "Matching items" } },
        },
      },
      "/api/inventory/{id}": {
        get: {
          operationId: "getItem",
          summary: "Get one item by code (e.g. BO-00071)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, lang],
          responses: { 200: { description: "The item" }, 404: { description: "Not in stock" } },
        },
      },
      "/api/categories": {
        get: { operationId: "listCategories", summary: "Categories with in-stock counts", parameters: [lang], responses: { 200: { description: "Categories" } } },
      },
      "/api/store": {
        get: { operationId: "getStoreInfo", summary: "Address, hours, WhatsApp, SINPE Móvil, email and purchase policy", responses: { 200: { description: "Store info" } } },
      },
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, searchParams, origin } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "*" },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method_not_allowed" }, 405);

    const lang = searchParams.get("lang") === "en" ? "en" : "es";

    try {
      if (pathname === "/api/health") {
        const inv = await loadInventory(env, origin);
        return json({ ok: true, items: inv.items.length, generated_at: inv.generated_at }, 200, { "cache-control": "no-store" });
      }
      if (pathname === "/api/openapi.json") return json(openapi(origin));
      if (pathname === "/api/store") return json(STORE);

      const inv = await loadInventory(env, origin);
      const meta = { generated_at: inv.generated_at, sample: inv.sample };

      if (pathname === "/api/categories") {
        const counts = {};
        for (const it of inv.items) counts[it.category] = (counts[it.category] || 0) + 1;
        return json({
          ...meta,
          categories: Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([id, count]) => ({ id, label: (CATEGORIES[id] || CATEGORIES.otros)[lang], count })),
        });
      }

      if (pathname === "/api/inventory/search" || pathname === "/api/inventory") {
        const limit = Math.min(Math.max(num(searchParams.get("limit")) ?? 10, 1), MAX_LIMIT);
        const { matched, results } = search(inv.items, searchParams);
        return json({
          ...meta,
          total: results.length,
          matched,
          items: results.slice(0, limit).map((it) => publicItem(it, origin, lang)),
          catalog_url: new URL(lang === "en" ? "/inventory.html" : "/inventario.html", origin).href,
        });
      }

      const m = pathname.match(/^\/api\/inventory\/([A-Za-z0-9_-]+)$/);
      if (m) {
        const id = m[1].toUpperCase();
        const it = inv.items.find((x) => x.id.toUpperCase() === id);
        return it ? json({ ...meta, item: publicItem(it, origin, lang) }) : json({ error: "not_found", id }, 404);
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "internal_error" }, 500, { "cache-control": "no-store" });
    }
  },
};
