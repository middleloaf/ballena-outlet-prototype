#!/usr/bin/env node
// Local importer: workbook -> data/inventory.json, using the same code the
// admin panel runs in the Worker (worker/importer.js).
//
//   node tools/import-inventory.mjs inventario.xlsx --dry-run
//   node tools/import-inventory.mjs inventario.xlsx --photos-dir ~/fotos --flyers-dir ~/flyers
//
// Production inventory is managed from /admin (or ChatGPT); this is for local
// previews and for seeding the committed fallback file.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildInventory, fold, ImportError, readWorkbook } from "../worker/importer.js";
import { codeFromImage, IMAGE_EXTS } from "../worker/images.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE_DIR = join(ROOT, "assets", "inventory");

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: join(ROOT, "data", "inventory.json") },
    "photos-dir": { type: "string" },
    "flyers-dir": { type: "string" },
    sample: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const source = positionals[0];
if (!source || !existsSync(source)) {
  console.error("Uso: node tools/import-inventory.mjs <archivo.xlsx|.csv> [--dry-run] [--photos-dir DIR] [--flyers-dir DIR]");
  process.exit(1);
}

const defaultDir = (name) => {
  const dir = join(ROOT, "data", "source", name);
  return existsSync(dir) ? dir : undefined;
};
const photosDir = opts["photos-dir"] ?? defaultDir("photos");
const flyersDir = opts["flyers-dir"] ?? defaultDir("flyers");

function listImages(dir) {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => IMAGE_EXTS.includes(extname(f).toLowerCase()))
    .sort()
    .map((f) => join(dir, f));
}

const copied = new Set();
function copyImage(file) {
  if (opts["dry-run"]) return `assets/inventory/${basename(file)}`;
  mkdirSync(IMAGE_DIR, { recursive: true });
  const digest = createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 10);
  const ext = IMAGE_EXTS.includes(extname(file).toLowerCase()) ? extname(file).toLowerCase() : ".jpg";
  const target = join(IMAGE_DIR, `${fold(basename(file, extname(file))) || "item"}-${digest}${ext}`);
  if (!existsSync(target)) copyFileSync(file, target);
  copied.add(file);
  return relative(ROOT, target).split("\\").join("/");
}

// Images named after the code (BO-00001.jpg, BO-00001-frente.jpg) or carrying
// the code in their metadata; byName serves sheets with a foto/flyer column.
const images = { byCode: {}, byName: {} };
const unused = [];
for (const [dir, key] of [[photosDir, "foto"], [flyersDir, "flyer_es"]]) {
  for (const file of listImages(dir)) {
    const lazy = () => copyImage(file);
    let path;
    Object.defineProperty(images.byName, basename(file).toLowerCase(), { enumerable: true, get: () => (path ??= lazy()) });
    const code = /^(bo-\d{5})(?!\d)/i.exec(basename(file))?.[1]?.toUpperCase() ?? codeFromImage(readFileSync(file));
    if (code && !images.byCode[code]?.[key]) {
      images.byCode[code] = { ...images.byCode[code], [key]: (path ??= lazy()) };
    } else if (!code) unused.push(file);
  }
}

try {
  const { payload, report } = await buildInventory(readWorkbook(readFileSync(source), source), {
    images,
    sample: opts.sample,
  });
  console.log(`Hoja: ${report.sheet} · Leídas: ${report.rows_read} filas · Publicadas: ${report.published} · Omitidas: ${report.skipped.length}`);
  const guessed = Object.entries(report.categories_guessed).sort((a, b) => b[1] - a[1]);
  if (guessed.length) console.log("  categorías: " + guessed.map(([k, v]) => `${k}=${v}`).join(", "));
  for (const line of report.skipped) console.log(`  omitida  ${line}`);
  for (const line of report.warnings) console.log(`  aviso    ${line}`);
  if (unused.length) {
    console.log(`  aviso    ${unused.length} imágenes sin código en el nombre ni en los metadatos:`);
    for (const f of unused.slice(0, 5)) console.log(`           · ${basename(f)}`);
  }
  if (opts["dry-run"]) {
    console.log("Dry run: no se escribió nada.");
  } else {
    writeFileSync(opts.out, JSON.stringify(payload, null, 2) + "\n");
    console.log(`Escrito: ${relative(ROOT, resolve(opts.out)) || opts.out}`);
  }
} catch (err) {
  if (err instanceof ImportError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
