// Inventory importer: workbook (.xlsx / .csv) -> public inventory payload.
//
// Runs in the Worker (admin uploads) and in Node (tools/import-inventory.mjs),
// so there is exactly one implementation of the column mapping, quantity
// rules and category inference. Only rows marked available are published and
// internal columns (cost, supplier, notes) never reach the payload.

import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { spanishSearchTerms } from "./search-es.js";

// Categories must match the product groups used by the site.
const CATEGORIES = {
  electrodomesticos: ["electrodomesticos", "electrodomestico", "linea_blanca", "appliances", "appliance"],
  hogar: ["hogar", "casa", "home", "cocina", "menaje", "kitchen"],
  textiles: ["textiles", "alfombras", "alfombra", "tapetes", "textiles_y_alfombras", "rugs", "textile"],
  juguetes: ["juguetes", "juguete", "ninos", "juguetes_y_ninos", "toys", "toy"],
  electronica: ["electronica", "electronicos", "electronics", "tecnologia", "technology"],
  belleza: ["belleza", "cuidado_personal", "belleza_y_cuidado_personal", "beauty", "cosmetica", "cosmetics"],
  mejoras_hogar: ["mejoras_hogar", "mejoras", "mejoras_para_el_hogar", "home_improvement", "home improvement", "ferreteria"],
  herramientas: ["herramientas", "jardin", "herramientas_y_jardin", "tools", "garden"],
  ropa: ["ropa", "calzado", "ropa_y_calzado", "apparel", "clothing", "shoes"],
};
export const CATEGORY_SLUGS = [...Object.keys(CATEGORIES), "otros"];
const CATEGORY_LOOKUP = lookup(CATEGORIES);

const CONDITIONS = {
  nuevo: ["nuevo", "new", "nueva", "sellado", "sealed"],
  como_nuevo: ["como_nuevo", "like_new", "open_box", "caja_abierta", "exhibicion"],
  usado: ["usado", "usada", "used", "segunda_mano", "segunda"],
  para_partes: ["para_partes", "repuesto", "for_parts", "parts", "danado", "damaged"],
};
export const CONDITION_SLUGS = Object.keys(CONDITIONS);
const CONDITION_LOOKUP = lookup(CONDITIONS);

const PUBLISHED_STATUS = new Set(["disponible", "available", "activo", "publicado", "published"]);

const COLUMNS = {
  id: ["id", "sku", "codigo", "codigo_item", "item_id"],
  nombre_es: ["nombre_es", "nombre", "producto", "articulo", "nombre_producto", "item"],
  nombre_en: ["nombre_en", "name_en", "english_name", "nombre_ingles"],
  buscar_es: ["buscar_es", "buscar", "palabras_es", "keywords_es", "search_es"],
  detalle_es: ["detalle_es", "detalle", "descripcion_es", "descripcion", "description_es"],
  detalle_en: ["detalle_en", "descripcion_en", "description_en", "description"],
  categoria: ["categoria", "categoria_es", "category", "grupo", "tipo", "rubro"],
  condicion: ["condicion", "condicion_fisica", "estado_fisico", "condition"],
  precio_crc: ["precio_crc", "precio", "precio_colones", "precio_es", "price", "price_crc", "precio_venta", "precio_etiqueta"],
  cantidad: ["cantidad", "qty", "stock", "unidades", "quantity"],
  cantidad_manifiesto: ["cantidad_manifiesto", "manifiesto", "cantidad_original"],
  conteo_t1: ["conteo_tienda_1", "conteo_t1", "conteo_tienda1"],
  conteo_t2: ["conteo_tienda_2", "conteo_t2", "conteo_tienda2"],
  conteo_bodega: ["conteo_bodega", "conteo_deposito"],
  total_actual: ["total_actual", "total_actual_por_configurar", "actual_total"],
  foto: ["foto", "foto_es", "photo", "imagen", "image", "imagen_es", "ruta_foto"],
  flyer_es: ["flyer_es", "flyer", "flyer_sp", "flyer_espanol"],
  flyer_en: ["flyer_en", "flyer_ingles", "flyer_english"],
  estado: ["estado", "status", "disponibilidad", "estado_publicacion", "estado_por_configurar"],
};
const COLUMN_LOOKUP = lookup(COLUMNS);

// Name-based categories for sheets without a category column. Overrides are
// checked first; within a list the first matching key wins.
const CATEGORY_RULES = [
  ["juguetes", ["lego", "playmobil", "pokemon", "pokémon", "pikachu", "tonies", "gigglescape", "board game",
    "card game", "plush", "figure", "figurine", "building set", "building toy", "puzzle", "doll",
    "dollhouse", "toy", "toys", "playset", "play set", "nerf", "barbie", "hot wheels", "funko",
    "squishmallow", "magnatile", "magna-tiles", "play-doh", "knex", "action figure", "stuffed",
    "cards against humanity", "who's most likely", "chameleon", "party game", "remote control",
    "rc", "r/c", "playground", "ride-on", "tricycle", "scooter", "blocks", "magnetic tiles",
    "game", "games", "marvel", "star wars", "disney", "bluey", "hasbro", "spin master", "vtech",
    "fao schwarz", "tetris", "arcade", "slingshot", "blaster", "fx fists", "drone", "tiny land",
    "exploding kittens", "sequence", "goliath", "guess who", "hyper burst", "battle", "collectible",
    "mini brands", "zuru", "l.o.l.", "leapfrog", "transformers", "melissa", "fisher-price",
    "paw patrol", "spider-man", "sesame street", "mario", "prestonplayz", "mrbeast", "amiibo",
    "g.i. joe", "gi joe", "power rangers", "playhouse", "hulk", "kirby", "book", "books", "minions",
    "fists", "sprinkler", "piano", "dino", "matchbox", "beyblade", "little tikes", "pixar",
    "minecraft", "maisto", "monopoly", "clixo", "tonka", "case files", "trading cards",
    "booster box", "launcher", "vehicle", "jet", "lankybox"]],
  ["electrodomesticos", ["refrigerator", "fridge", "microwave", "air fryer", "coffee maker", "espresso",
    "blender", "toaster", "oven", "dishwasher", "washer", "dryer", "freezer", "kettle",
    "griddle", "waffle maker", "slow cooker", "pressure cooker", "rice cooker",
    "stand mixer", "hand mixer", "juicer", "food processor", "vacuum", "steam iron",
    "humidifier", "air purifier", "fan", "heater", "slushi", "slushy", "shaved ice",
    "drink maker", "soda maker", "ice maker", "range hood", "cooktop", "stove",
    "dehydrator", "sous vide", "milk frother", "charging station", "water dispenser",
    "popcorn", "side tank", "fryer", "cotton candy", "fountain", "ice cream", "ice pop",
    "coffee machine", "water boiler", "egg cooker", "egg bite"]],
  ["textiles", ["rug", "rugs", "carpet", "towel", "towels", "blanket", "throw blanket", "pillow", "pillows",
    "pillowcase", "duvet", "comforter", "sheet set", "bedding", "quilt", "curtain", "curtains",
    "tablecloth", "table runner", "placemat", "napkin", "bath mat", "kitchen mat", "floor mat",
    "doormat", "comfort mat", "mat", "mats", "tapestry", "bed skirt", "mattress pad", "coverlet",
    "sham", "bath sheet", "bath towel", "hand towel", "washcloth"]],
  ["ropa", ["jacket", "shirt", "t-shirt", "tee", "pants", "jeans", "dress", "skirt", "sweater", "hoodie",
    "sweatshirt", "socks", "shoes", "sneakers", "boots", "sandals", "slippers", "underwear", "bra",
    "pajamas", "pajama", "coat", "vest", "scarf", "beanie", "gloves", "belt", "backpack", "handbag",
    "purse", "tote", "duffel", "luggage", "wallet"]],
  ["belleza", ["shampoo", "conditioner", "lotion", "moisturizer", "serum", "cleanser", "makeup", "mascara",
    "lipstick", "foundation", "perfume", "cologne", "deodorant", "toothpaste", "toothbrush", "razor",
    "hair dryer", "straightener", "curling iron", "skincare", "skin care", "sunscreen", "body wash",
    "soap", "nail", "cosmetic", "beauty", "brush set", "face mask", "shaving"]],
  ["mejoras_hogar", ["paint can", "paint bucket", "paint brush", "paint roller", "paint tray", "painting",
    "primer", "caulk", "sealant", "grout", "tile", "flooring", "laminate floor", "vinyl plank",
    "faucet", "shower head", "hand shower", "toilet seat", "bidet", "toilet plunger",
    "light fixture", "chandelier", "pendant", "sconce", "ceiling fan", "lamp", "led strip",
    "wall shelf", "floating shelf", "wall hook", "curtain rod", "towel bar", "towel ring", "towel rack",
    "toilet paper holder", "toilet tissue holder", "toilet paper stand",
    "wall cabinet", "medicine cabinet", "wall mounted cabinet",
    "door knob", "deadbolt", "hinge", "bracket",
    "air filter", "thermostat", "weatherstrip", "insulation", "outlet", "dimmer", "switch plate",
    "planter", "garden hose", "sprinkler", "soil", "mulch", "fertilizer"]],
  ["herramientas", ["drill", "saw", "hammer", "screwdriver", "wrench", "pliers", "tool set", "toolbox",
    "tool box", "ladder", "hose", "garden", "shovel", "rake", "lawn", "mower",
    "trimmer", "leaf blower", "workbench", "clamp", "level", "tape measure",
    "watering can", "wheelbarrow", "pruner", "shears", "tool", "tools"]],
  ["electronica", ["headset", "headphone", "earbud", "speaker", "soundbar", "keyboard", "mouse", "monitor",
    "webcam", "camera", "charger", "charging", "cable", "power bank", "tablet", "laptop",
    "phone case", "tv", "television", "projector", "router", "smart home", "doorbell",
    "chromecast", "roku", "gaming console", "controller", "playstation", "xbox", "nintendo",
    "usb", "bluetooth", "wi-fi", "wifi", "printer", "hard drive", "ssd",
    "memory card", "airtag", "tracker", "ring light", "microphone", "dash cam", "gps", "ps5",
    "nintendo switch"]],
  ["hogar", ["cookware", "box", "pot", "pots", "pan", "pans", "skillet", "dutch oven", "saucepan", "frying pan",
    "frypan", "wok", "bakeware", "baking dish", "casserole", "dinnerware", "stoneware", "plate",
    "plates", "bowl", "bowls", "mug", "mugs", "cup", "cups", "glass", "glasses", "tumbler", "jar",
    "jars", "container", "containers", "storage", "cabinet", "shelf", "shelves", "shelving", "desk",
    "table", "tables", "chair", "chairs", "stool", "bench", "sofa", "couch", "sectional", "ottoman",
    "bed", "beds", "headboard", "nightstand", "dresser", "drawer", "wardrobe", "bookcase", "lamp",
    "light", "lighting", "mirror", "frame", "vase", "candle", "candelabra", "decor", "decoration",
    "kitchen", "utensil", "cutlery", "flatware", "silverware", "knife", "cutting board", "colander",
    "strainer", "grater", "peeler", "whisk", "spatula", "ladle", "tongs", "dish rack", "drainer",
    "drying rack", "organizer", "basket", "bin", "hamper", "trash", "laundry", "cleaning", "mop",
    "broom", "sponge", "soap dispenser", "faucet", "sink", "shower", "bath", "toilet", "hook",
    "plant pot", "pet", "dog", "cat", "food jar", "serving", "shakers", "arrangement", "tray",
    "pitcher", "carafe", "bottle", "lunch", "cooler", "thermos", "apron", "oven mitt", "potholder",
    "trivet", "scale", "timer", "food storage", "spice", "grinder", "mortar", "ice bucket", "wine",
    "bar", "coffee", "tea", "salad spinner", "spinner", "wall art", "art", "art print", "canvas",
    "poster", "dispenser", "canister", "log holder", "fireplace", "bbq", "grill", "marble dish",
    "pottery", "diaper", "diapers", "wipes", "huggies", "pampers", "millie moon", "up&up", "baby",
    "teapot", "coaster", "lantern", "wreath", "snacklebox", "caddy", "display box", "ficus",
    "thermometer", "cake", "lazy susan", "salt cellar", "gift wrap", "movie screening", "towel holder",
    "towel bar", "towel ring", "paper towel", "fridge drawer", "tree", "rolling pin", "baking",
    "corkscrew", "jelly", "cookie sheet", "tortilla press", "caldero", "tub", "scoop", "carving board",
    "cookie", "press", "media stand", "stand", "artificial", "plant", "opener", "board", "water filter",
    "filtration system", "towel rack", "ninjamas"]],
];
const CATEGORY_OVERRIDES = [
  ["mejoras_hogar", ["shower curtain rod", "curtain rod", "towel bar", "towel ring", "towel rack",
    "toilet paper holder", "toilet tissue holder", "toilet paper stand",
    "wall shelf", "floating shelf", "ledge wall shelf", "wall cabinet", "medicine cabinet",
    "wall mounted cabinet", "wall hook", "over the door hook",
    "table lamp", "desk table lamp", "task lamp", "bookshelf lamp", "led strip", "led mirror",
    "toilet seat", "bidet", "toilet plunger", "hand shower", "shower head",
    "faucet mount", "faucet filtration"]],
  ["hogar", ["hammered", "diapers", "diaper", "caddy", "shelf", "shelves", "dish brush", "hand shower",
    "dutch oven", "towel rack", "ninjamas", "towel holder", "towel bar", "towel ring", "paper towel",
    "fridge drawer", "lunch tote", "lunch box"]],
  ["textiles", ["bath robe", "bath sheet", "bath towel", "hand towel", "washcloth",
    "bath rug", "bath mat", "kitchen mat", "comfort mat", "floor mat", "doormat"]],
];

// "Microwave & dishwasher safe" describes care, not the product.
const CARE_MASK =
  /\b(?:microwave|oven|dishwasher)(?:\s*(?:&|and|,)\s*(?:microwave|oven|dishwasher))*[\s-]*(?:and\s+)?safe\b/gi;
const SHORT_KEY = /^[a-z]{1,4}$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEY_CACHE = new Map();

function lookup(groups) {
  const out = {};
  for (const [slug, aliases] of Object.entries(groups)) for (const alias of aliases) out[alias] = slug;
  return out;
}

/** Lowercase, strip accents, collapse punctuation to underscores. */
export function fold(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function keywordMatch(text, key) {
  if (SHORT_KEY.test(key)) {
    let re = KEY_CACHE.get(key);
    if (!re) {
      // Only add the Spanish-style "es" plural for words that take it in
      // English (box -> boxes, dish -> dishes). Otherwise "mat" would match
      // "mates" and misclassify toys as textiles.
      const plural = /(?:s|x|z|ch|sh)$/.test(key) ? "(?:es|s)?" : "s?";
      KEY_CACHE.set(key, (re = new RegExp(`(?<![a-z])${escapeRe(key)}${plural}(?![a-z])`)));
    }
    return re.test(text);
  }
  return text.includes(key);
}

export function guessCategory(name) {
  const text = String(name).replace(CARE_MASK, " ").toLowerCase().replaceAll("tabletop", "table top");
  for (const rules of [CATEGORY_OVERRIDES, CATEGORY_RULES]) {
    for (const [slug, keys] of rules) for (const key of keys) if (keywordMatch(text, key)) return slug;
  }
  return "otros";
}

// Python's round() rounds half to even; keep the same results as the old importer.
function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function parseNumber(value, allowNegative) {
  if (value == null || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? roundHalfEven(value) : null;
  let text = String(value).trim();
  if (!text) return null;
  text = text.replace(allowNegative ? /[^\d.,-]/g : /[^\d.,]/g, "");
  if (!text) return null;
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(text)) return Number(text.replace(/[.,]/g, ""));
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? roundHalfEven(n) : null;
}
export const parsePrice = (v) => parseNumber(v, false);
export const parseInt_ = (v) => parseNumber(v, true);

const blank = (v) => String(v ?? "").trim() === "";

// ---- Readers ---------------------------------------------------------------

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ["si", "r", "t", "row", "c", "sheet", "Relationship"].includes(name),
});

function textOf(node) {
  // Concatenate every <t> under a node (rich-text runs included).
  if (node == null) return "";
  if (typeof node === "string") return node;
  let out = "";
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("@_")) continue;
    const list = Array.isArray(v) ? v : [v];
    for (const child of list) {
      if (k === "t") out += typeof child === "object" ? child["#text"] ?? "" : String(child ?? "");
      else if (typeof child === "object") out += textOf(child);
    }
  }
  return out;
}

function colIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref || "")?.[1] || "A";
  let i = 0;
  for (const ch of letters) i = i * 26 + ch.charCodeAt(0) - 64;
  return i - 1;
}

/** Returns { sheet, rows: [{ number, values }] } from .xlsx bytes. */
export function readXlsx(bytes) {
  let files;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name.startsWith("xl/") && f.name.endsWith(".xml") || f.name.endsWith(".rels") });
  } catch {
    throw new ImportError("El archivo no es un Excel .xlsx válido.");
  }
  const read = (name) => (files[name] ? xml.parse(strFromU8(files[name])) : null);

  const shared = (read("xl/sharedStrings.xml")?.sst?.si || []).map(textOf);
  const workbook = read("xl/workbook.xml")?.workbook;
  const rels = read("xl/_rels/workbook.xml.rels")?.Relationships?.Relationship || [];
  const targets = Object.fromEntries(rels.map((r) => [r["@_Id"], r["@_Target"]]));
  const sheets = (workbook?.sheets?.sheet || []).map((s) => [s["@_name"], targets[s["@_id"]]]);
  if (!sheets.length) throw new ImportError("El archivo no tiene hojas.");
  // Prefer the stock sheet when the workbook has one.
  const [name, rawTarget] = sheets.find(([n]) => (n || "").toLowerCase().includes("stock")) || sheets[0];
  let target = (rawTarget || "").replace(/^\/+/, "");
  if (!target.startsWith("xl/")) target = "xl/" + target;

  const sheet = read(target)?.worksheet;
  if (!sheet) throw new ImportError(`No se pudo leer la hoja '${name}'.`);
  const rows = [];
  let seq = 0;
  for (const row of sheet.sheetData?.row || []) {
    seq += 1;
    const values = [];
    for (const cell of row.c || []) {
      const i = cell["@_r"] ? colIndex(cell["@_r"]) : values.length;
      const kind = cell["@_t"];
      const v = cell.v == null ? null : typeof cell.v === "object" ? cell.v["#text"] ?? "" : String(cell.v);
      let value = "";
      if (kind === "s" && v != null) value = shared[Number(v)] ?? "";
      else if (kind === "inlineStr" && cell.is != null) value = textOf(cell.is);
      else if (v != null) value = v;
      while (values.length <= i) values.push("");
      values[i] = value;
    }
    rows.push({ number: Number(row["@_r"]) || seq, values });
  }
  return { sheet: name, rows };
}

/** Returns { sheet, rows } from CSV/TSV text (RFC 4180 quoting). */
export function readCsv(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] || "";
  const counts = [",", ";", "\t"].map((d) => [d, first.split(d).length - 1]);
  const delimiter = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[1] ? counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : ",";
  const rows = [];
  let row = [], field = "", quoted = false, number = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push({ number, values: row }); row = []; field = ""; number++;
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push({ number, values: row }); }
  return { sheet: "csv", rows };
}

export function readWorkbook(bytes, filename = "") {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return readXlsx(bytes);
  if (/\.(csv|tsv|txt)$/.test(lower)) {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { text = new TextDecoder("latin1").decode(bytes); }
    return readCsv(text);
  }
  if (lower.endsWith(".xls")) throw new ImportError("El formato .xls (Excel 97-2003) no es compatible. Guardá el archivo como .xlsx.");
  throw new ImportError("Formato no soportado. Usá .xlsx o .csv.");
}

export class ImportError extends Error {}

// ---- Build -----------------------------------------------------------------

async function sha1Hex(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function resolveQuantity(raw) {
  const counts = ["conteo_t1", "conteo_t2", "conteo_bodega"].map((k) => raw[k]);
  if (counts.some((v) => !blank(v))) return counts.reduce((sum, v) => sum + (blank(v) ? 0 : parseInt_(v) ?? 0), 0);
  for (const field of ["total_actual", "cantidad_manifiesto", "cantidad"]) {
    if (!blank(raw[field])) {
      const n = parseInt_(raw[field]);
      if (n != null) return n;
    }
  }
  return 1;
}

/**
 * Resolve an image reference from a sheet cell. Absolute URLs and repo paths
 * pass through; bare filenames are matched against uploaded images.
 */
function resolveSheetImage(value, images, warnings, label) {
  if (blank(value)) return null;
  const raw = String(value).trim().replace(/\\/g, "/");
  if (/^https?:\/\//i.test(raw) || raw.startsWith("assets/")) return raw;
  const name = raw.split("/").pop().toLowerCase();
  const hit = images?.byName?.[name];
  if (hit) return hit;
  warnings.push(`${label}: no se encontró la imagen '${value}' (se omite). Subila con el código del artículo.`);
  return null;
}

/**
 * Build the public payload from sheet rows.
 * `images` = { byCode: { "BO-00001": { foto, flyer_es, flyer_en } }, byName: { "img_1234.jpg": "assets/..." } }
 * Uploaded images (byCode) win over sheet columns: they are the latest explicit action.
 */
export async function buildInventory({ rows, sheet }, { images = {}, sample = false } = {}) {
  const warnings = [];
  const skipped = [];
  const items = [];
  const seen = new Set();
  const guessed = {};
  let missingEn = 0;

  if (!rows.length) throw new ImportError("La hoja está vacía.");
  const header = rows[0].values.map(fold);
  const fields = header.map((h) => COLUMN_LOOKUP[h] ?? null);
  if (!fields.includes("nombre_es")) {
    throw new ImportError(
      "Falta la columna de nombre. Se acepta 'nombre_es', 'nombre', 'producto' o 'articulo'. " +
        `Encabezados leídos: ${rows[0].values.join(", ")}`,
    );
  }

  for (const { number, values } of rows.slice(1)) {
    if (!values.some((v) => !blank(v))) continue;
    const raw = {};
    fields.forEach((field, i) => {
      if (field && i < values.length && !blank(values[i])) raw[field] = values[i];
    });

    const label = `fila ${number}`;
    const nameEs = String(raw.nombre_es ?? "").trim();
    if (!nameEs) {
      warnings.push(`${label}: sin nombre (se omite).`);
      continue;
    }

    const status = fold(raw.estado ?? "disponible") || "disponible";
    if (!PUBLISHED_STATUS.has(status)) {
      skipped.push(`${label}: ${nameEs.slice(0, 60)} (estado: ${status})`);
      continue;
    }

    let category = null;
    if (!blank(raw.categoria)) {
      category = CATEGORY_LOOKUP[fold(raw.categoria)] ?? null;
      if (!category) warnings.push(`${label}: categoría '${raw.categoria}' no reconocida; se deduce del nombre.`);
    }
    if (!category) {
      category = guessCategory(nameEs);
      guessed[category] = (guessed[category] || 0) + 1;
    }

    let condition = null;
    if (!blank(raw.condicion)) {
      condition = CONDITION_LOOKUP[fold(raw.condicion)] ?? null;
      if (!condition) warnings.push(`${label}: condición '${raw.condicion}' no reconocida (se omite).`);
    }

    const price = parsePrice(raw.precio_crc);
    if (!blank(raw.precio_crc) && price == null) {
      warnings.push(`${label}: precio '${raw.precio_crc}' no es un número (se publica sin precio).`);
    }

    const qty = resolveQuantity(raw);
    if (qty <= 0) {
      skipped.push(`${label}: ${nameEs.slice(0, 60)} (cantidad 0)`);
      continue;
    }

    const id =
      String(raw.id ?? "").trim() ||
      "item-" + (await sha1Hex(`${raw.nombre_es ?? ""}|${raw.precio_crc ?? ""}|${number}`)).slice(0, 8);
    if (seen.has(id)) {
      warnings.push(`${label}: código duplicado '${id}' (se omite).`);
      continue;
    }
    seen.add(id);

    const item = { id, name_es: nameEs, category, qty };
    const nameEn = String(raw.nombre_en ?? "").trim();
    if (nameEn) item.name_en = nameEn;
    else missingEn += 1;
    for (const [field, key] of [["detalle_es", "detail_es"], ["detalle_en", "detail_en"]]) {
      const v = String(raw[field] ?? "").trim();
      if (v) item[key] = v;
    }
    const searchEs = spanishSearchTerms({
      names: [nameEs, nameEn],
      category,
      manual: raw.buscar_es,
    });
    if (searchEs) item.search_es = searchEs;
    if (condition) item.condition = condition;
    if (price != null) item.price_crc = price;

    const uploaded = images.byCode?.[id.toUpperCase()] || {};
    for (const key of ["foto", "flyer_es", "flyer_en"]) {
      const value = uploaded[key] || resolveSheetImage(raw[key], images, warnings, label);
      if (value) item[key] = value;
    }
    items.push(item);
  }

  if (missingEn) warnings.push(`${missingEn} artículos sin nombre en inglés; la página EN muestra el nombre en español.`);
  const others = items.filter((i) => i.category === "otros");
  if (others.length) {
    warnings.push(`${others.length} artículos quedaron en 'otros': ` + others.slice(0, 5).map((i) => i.name_es).join("; "));
  }
  const unmatched = Object.keys(images.byCode || {}).filter((code) => !seen.has(code) && ![...seen].some((s) => s.toUpperCase() === code));
  if (unmatched.length) {
    warnings.push(`${unmatched.length} imágenes subidas no corresponden a ningún artículo publicado: ${unmatched.slice(0, 8).join(", ")}`);
  }

  const payload = {
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    sample: Boolean(sample),
    count: items.length,
    items,
  };
  const report = {
    sheet,
    rows_read: Math.max(0, rows.length - 1),
    published: items.length,
    skipped,
    warnings,
    categories_guessed: guessed,
  };
  return { payload, report };
}
