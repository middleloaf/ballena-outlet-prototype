# Inventory source files — temporary English note

> **Temporary.** This file is for whoever is building the prototype. Delete it
> before handing the site over; `README.md` in this folder is the keeper.

Everything that feeds the “Disponible hoy / Available today” section lives
here. Nothing in this folder is published as-is: the importer reads it, keeps
only available rows, and writes `data/inventory.json`, which is the only file
the site fetches.

## Layout

```
data/source/
├── Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx   Store workbook (STOCK TIENDAS)
├── photos/                                              Real product photos
├── flyers/                                              Marketing flyers with baked-in text
├── README.md                                            Spanish guide (permanent)
└── README.en.md                                         This note (delete later)
```

Photos, flyers, and the workbook are git-ignored, and so is the real
inventory: the repository only ships a sample. The real inventory is published
from the site's `/admin/` panel (workbook, photos and flyers are uploaded
there). This folder is for local tests with `node tools/import-inventory.mjs`.

## How images attach

Name the file with the product code:

```
photos/BO-00001.jpg
flyers/BO-00317.jpeg
```

Suffixes (`BO-00001-front.jpg`) and JPG/PNG/WebP/AVIF/GIF are accepted. If the
filename has no usable code, the importer also checks image metadata (EXIF
ImageDescription/UserComment/XMP, PNG Description/Comment) for `BO-xxxxx`.
WhatsApp and Instagram strip metadata, so chat-sourced files must be renamed.

Unmatched files are listed with their exact names on every import.

## Photos vs flyers

- **Photo** — real product image, used as the card image.
- **Flyer** — marketing image with baked-in text. Used as the card image only
  when there is no photo; always reachable through “Ver flyer”. Rendered
  letterboxed so text is not cropped.
- A product can have both. `flyer_en` in the sheet overrides the Spanish flyer
  on the English page.

## Workflow

```bash
node tools/import-inventory.mjs data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx --dry-run
node tools/import-inventory.mjs data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx
```

Save the workbook before importing — the importer reads the last saved file,
not unsaved edits in LibreOffice/Excel.

The report lists published rows, skipped rows (status other than
`disponible`), warnings, and unmatched images. Only available rows are
exported; cost, supplier and notes never reach the public JSON.

## Fields read from the sheet

`Código`, `Producto`, `Cantidad manifiesto`, `Precio etiqueta ₡`,
`Conteo Tienda 1`, `Conteo Tienda 2`, `Conteo bodega`, `Total actual`,
`Estado`.

Quantity prefers the physical counts, then `Total actual`, then the manifest
as a provisional fallback. Internal sheets such as `INVENTARIO ORIGINAL`
(cost, base amount, discount) are ignored. Category is inferred from the
product name when the sheet has none. Hidden Spanish search aliases are generated from the name and category (glossary in `worker/search-es.js`); an optional `buscar_es` column adds per-item aliases such as `refri, nevera, refrigeradora`.

## Image handling notes

- Convert to WebP/JPEG around 900–1200px on the long side and under ~200 KB before importing.
- Copies are content-addressed (`bo_00317-10bdc254eb.jpeg`), so re-importing
  the same image reuses the same path instead of creating duplicates.
- There is no OCR/barcode reader in this environment: a code printed *in the
  pixels* is not read. Put the code in the filename or metadata.
- Kapso will later read the same `data/inventory.json` (or the database behind
  it), so this pipeline stays the single source of truth.
