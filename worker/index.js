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
  hours: null,
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
        get: { operationId: "getStoreInfo", summary: "Address, WhatsApp, email and purchase policy", responses: { 200: { description: "Store info" } } },
      },
    },
  };
}

// ---- Operations shared by the REST API and the MCP server -----------------

function categoriesOp(inv, lang) {
  const counts = {};
  for (const it of inv.items) counts[it.category] = (counts[it.category] || 0) + 1;
  return {
    generated_at: inv.generated_at,
    categories: Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: (CATEGORIES[id] || CATEGORIES.otros)[lang], count })),
  };
}

function searchOp(inv, params, origin, lang) {
  const limit = Math.min(Math.max(num(params.get("limit")) ?? 10, 1), MAX_LIMIT);
  const { matched, results } = search(inv.items, params);
  return {
    generated_at: inv.generated_at,
    sample: inv.sample,
    total: results.length,
    matched,
    items: results.slice(0, limit).map((it) => publicItem(it, origin, lang)),
    catalog_url: new URL(lang === "en" ? "/inventory.html" : "/inventario.html", origin).href,
  };
}

function itemOp(inv, rawId, origin, lang) {
  const id = String(rawId || "").trim().toUpperCase();
  const it = inv.items.find((x) => x.id.toUpperCase() === id);
  return it ? { generated_at: inv.generated_at, item: publicItem(it, origin, lang) } : null;
}

// ---- MCP (streamable HTTP, stateless, JSON responses) ----------------------
//
// Kapso agent nodes accept remote MCP servers over streamable HTTP. Exposing
// typed tools lets the agent's model choose arguments from the conversation
// instead of us templating URLs. Every request is independent, so there is no
// session state and no SSE stream (GET returns 405, which the spec allows).

const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const LANG_PROP = {
  type: "string",
  enum: ["es", "en"],
  description: "Language for names/labels in the result. Use the customer's language.",
};

const MCP_TOOLS = [
  {
    name: "search_inventory",
    title: "Search Ballena Outlet inventory",
    description:
      "Search items currently in stock at Ballena Outlet (Uvita, Costa Rica). Product names are English U.S. retail listings, so translate the customer's request into short English product keywords (e.g. 'licuadora' -> 'blender', 'freidora de aire' -> 'air fryer', 'juguetes de LEGO' -> 'lego'). Every keyword must start a word in the name; items matching all keywords rank first. Prices are tag prices in Costa Rican colones (CRC). Returns up to `limit` items plus `total` matches and a link to the full catalog. If nothing matches, retry with fewer or more general keywords, or browse by category.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "English product keywords. Omit to browse by category/price only." },
        category: { type: "string", enum: Object.keys(CATEGORIES), description: "Optional product group." },
        min_price_crc: { type: "integer", minimum: 0, description: "Optional minimum price in CRC." },
        max_price_crc: { type: "integer", minimum: 0, description: "Optional maximum price in CRC (the customer's budget)." },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: 8 },
        lang: LANG_PROP,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_item",
    title: "Get one item by code",
    description:
      "Look up one product by its code (e.g. BO-00071), for example when a customer sends a code from a flyer or the website. Returns found=false when the item is sold out or does not exist.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Product code, e.g. BO-00071." }, lang: LANG_PROP },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_categories",
    title: "List product categories",
    description: "Product groups currently in stock with item counts. Use when the customer asks what the store sells.",
    inputSchema: { type: "object", properties: { lang: LANG_PROP }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_store_info",
    title: "Store info",
    description:
      "Address, WhatsApp, email, how buying works (in-store pickup, shipping from the store, no online checkout) and the pricing note. Hours are not published; ask the customer to confirm by WhatsApp.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

async function callTool(name, args, env, origin) {
  const lang = args?.lang === "en" ? "en" : "es";
  if (name === "get_store_info") return STORE;
  const inv = await loadInventory(env, origin);
  if (name === "list_categories") return categoriesOp(inv, lang);
  if (name === "get_item") return itemOp(inv, args?.id, origin, lang) ?? { found: false, id: args?.id ?? null };
  if (name === "search_inventory") {
    const p = new URLSearchParams();
    if (args?.query) p.set("q", String(args.query));
    if (args?.category) p.set("category", String(args.category));
    if (args?.min_price_crc != null) p.set("min_price", String(args.min_price_crc));
    if (args?.max_price_crc != null) p.set("max_price", String(args.max_price_crc));
    p.set("limit", String(args?.limit ?? 8));
    return searchOp(inv, p, origin, lang);
  }
  return undefined;
}

async function handleRpc(msg, env, origin) {
  const isNotification = msg == null || msg.id === undefined || msg.id === null;
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code, message } });

  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid Request");
  if (isNotification) return null; // notifications/initialized, cancelled, etc.

  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return reply({
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ballena-outlet-inventory", title: "Ballena Outlet inventory", version: "1.0.0" },
        instructions:
          "Read-only live inventory for Ballena Outlet. Search with English product keywords; reply to customers in their language. Availability is confirmed in store or by WhatsApp; there is no online checkout.",
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: MCP_TOOLS });
    case "tools/call": {
      const { name, arguments: args } = msg.params || {};
      if (!MCP_TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      try {
        const data = await callTool(name, args || {}, env, origin);
        return reply({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: false });
      } catch (err) {
        console.error(err);
        return reply({ content: [{ type: "text", text: "Inventory is temporarily unavailable." }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

async function handleMcp(request, env, origin) {
  const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "mcp-session-id" };
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST, OPTIONS", ...cors } });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400, { "cache-control": "no-store" });
  }
  const batch = Array.isArray(body);
  const replies = (await Promise.all((batch ? body : [body]).map((m) => handleRpc(m, env, origin)))).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202, headers: cors });
  return json(batch ? replies : replies[0], 200, { "cache-control": "no-store" });
}

// ---- Router ----------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, searchParams, origin } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "*",
          "access-control-max-age": "86400",
        },
      });
    }

    if (pathname === "/mcp") return handleMcp(request, env, origin);

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

      if (pathname === "/api/categories") return json(categoriesOp(inv, lang));
      if (pathname === "/api/inventory/search" || pathname === "/api/inventory") {
        return json(searchOp(inv, searchParams, origin, lang));
      }

      const m = pathname.match(/^\/api\/inventory\/([A-Za-z0-9_-]+)$/);
      if (m) {
        const found = itemOp(inv, m[1], origin, lang);
        return found ? json(found) : json({ error: "not_found", id: m[1].toUpperCase() }, 404);
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "internal_error" }, 500, { "cache-control": "no-store" });
    }
  },
};
