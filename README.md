# Ballena Outlet — bilingual storefront prototype

A Spanish/English website for **Ballena Outlet**, a liquidation store in Uvita, Costa Rica that buys pallets of customer returns, overstock, and unclaimed packages from major U.S. retailers and sells the items by the piece.

- **Spanish site:** `index.html` (Costa Rica flag / ES)
- **English site:** `en.html` (U.S. flag / EN)
- **Shared design:** `styles.css`
- **Interactions:** `script.js` (mobile menu, reveals, FAQ behavior, feed labeling)
- **Assets:** `assets/` (storefront hero, real store photos, SVG brand logo, SVG favicon)

## Run locally

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173/index.html` (Spanish) or `http://localhost:4173/en.html` (English).

## What's included

- Full bilingual copy with a persistent flag-based language switch.
- Store details: Plaza La Perla del Pacífico, next to Servicentro Ballena, upstairs from Farmacia Ballena, Uvita, Costa Rica.
- WhatsApp `6313 2925` shown on the main WhatsApp buttons, email `ballena.outletafacturacion@hotmail.com`, Facebook, Instagram, and TikTok links as buttons.
- Social feeds and buttons placed near the top. The feed order is Facebook, Instagram, TikTok. Facebook and Instagram show the latest reel because their page/profile plugins do not render reels reliably; TikTok uses the standalone embed iframe (avoids TikTok `embed.js` overload protection). Direct-profile fallbacks remain for all three.
- Real store photos in the “Un lugar real / A real place” section, with a provisional-photo disclaimer and a Google Maps location embed.
- Store pickup and in-store shipping messaging throughout; no online checkout.
- Product groups with clearer examples, how-it-works steps, value props, FAQ, and a mobile quick-action bar.
- A live “Disponible hoy / Available today” section on both pages, rendered from `data/inventory.json` (built from a spreadsheet, see below).
- Persistent prototype notice in both languages, a detailed “About this prototype” section, and `noindex` metadata so search engines do not treat the demo as final.

## Inventory from a spreadsheet

The available-items section reads `data/inventory.json`. That file is generated from an Excel/CSV sheet by `tools/import_inventory.py`; nothing is typed into the HTML.

```bash
# Try the demo data (7 sample items, marked as sample in the UI)
python3 tools/import_inventory.py data/inventory.sample.csv --sample

# Import the store's workbook (STOCK TIENDAS sheet)
python3 tools/import_inventory.py data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx

# Photos go in data/source/photos/, flyers in data/source/flyers/; the importer picks them up automatically
python3 tools/import_inventory.py data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx

# Validate without writing anything
python3 tools/import_inventory.py inventario.xlsx --dry-run
```

`.xlsx` is read with the Python standard library (no `openpyxl`, no pip), so the workbook can be imported as-is. Serve the site over HTTP (`python3 -m http.server 4173`) — `fetch()` cannot read `data/inventory.json` from `file://`.

### The Ballena Outlet workbook

`data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx` is the store's real workbook. The importer automatically picks the sheet whose name contains “stock” (`STOCK TIENDAS`) and reads:

`Código`, `Producto`, `Cantidad manifiesto`, `Precio etiqueta ₡`, `Conteo Tienda 1`, `Conteo Tienda 2`, `Conteo bodega`, `Total actual`, `Estado`.

- **Quantity** prefers the physical store counts. While those columns are empty it falls back to `Total actual`, then to `Cantidad manifiesto` as a provisional quantity, so the site can go live before the count is finished. Rows at 0 are hidden.
- **Price** is the tag price from the sheet. The 15% discount in `INVENTARIO ORIGINAL` is applied at the register, not on the site: the card shows the tag price, and that sheet (cost, base amount, discounted price) is not read, so internal figures never reach the public JSON.
- **Category** is inferred from the product name when the sheet has no category column; the import report prints the distribution and flags anything left in `otros`.
- **Photos/flyers** are matched by product code (`BO-00001.jpg`) when `--photos-dir`/`--flyers-dir` is given. Until photos exist, cards show a neutral placeholder with the product group, so the list is still usable.

`MOVIMIENTOS` and `VENTAS PREVIAS` are not used by the importer yet; when they are, sales should reduce the published quantity instead of being re-counted by hand.

### Sheet columns

One row per item. Header names are matched accent- and case-insensitively; these are accepted:

| Field | Accepted headers | Notes |
|---|---|---|
| ID | `id`, `sku`, `codigo` | Generated from the name if empty. Duplicates are dropped. |
| Spanish name | `nombre_es`, `nombre`, `producto`, `articulo` | Required. |
| English name | `nombre_en`, `name_en` | Optional; the EN page falls back to Spanish and the import warns. |
| Details | `detalle_es`, `detalle_en` | Optional, clamped to two lines. |
| Category | `categoria`, `category`, `grupo` | Must map to the site's groups: `electrodomesticos`, `hogar`, `mejoras_hogar`, `textiles`, `juguetes`, `electronica`, `belleza`, `herramientas`, `ropa`. Unknown values fall back to name-based inference with a warning. |
| Condition | `condicion`, `estado_fisico`, `condition` | `nuevo`, `como_nuevo`, `usado`, `para_partes` (English synonyms accepted). |
| Price | `precio_crc`, `precio`, `price` | Optional integer colones. Empty = “Consultar precio”. |
| Quantity | `cantidad`, `stock`, `qty` | 0 hides the row; >1 shows “N disponibles”. The Ballena sheet's `Conteo Tienda 1/2`, `Conteo bodega`, `Total actual` and `Cantidad manifiesto` columns are resolved automatically. |
| Photo | `foto`, `photo`, `imagen` | Filename or repo path. With `--photos-dir` the file is copied to `assets/inventory/`. |
| Flyers | `flyer_es`, `flyer_en` | AI flyers with baked-in text; the ES page prefers `flyer_es`, the EN page `flyer_en` then falls back. Shown in a lightbox. |
| Status | `estado`, `status`, `disponibilidad` | Only `disponible`/`available` is published; `reservado`, `vendido`, `oculto` are skipped and listed in the import report. |

Any other column (cost, supplier, internal notes) is ignored and never reaches the public JSON.

### Attaching photos and flyers

There are two ways to attach an image to a product:

1. **By product code (bulk).** Drop the files in `data/source/photos/`, named after the code: `BO-00001.jpg`, `BO-00002.jpg`, … Then run
   `python3 tools/import_inventory.py data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx`.
   The importer uses `data/source/photos/` and `data/source/flyers/` automatically when those folders exist; `--photos-dir`/`--flyers-dir` point it elsewhere. Suffixes such as `BO-00001-front.jpg` are accepted too.
2. **Per row.** Add a `foto` column to the sheet with the exact filename (`IMG_1234.jpg`) or a repo path, and put that file in `data/source/photos/` (or pass `--photos-dir`). This is the option when camera files are not renamed.

Flyers work the same way: either `flyer_es` / `flyer_en` columns with filenames, or `--flyers-dir ~/flyers` with code-named files. A flyer is only used as the card image when there is no photo; it is always available through “Ver flyer”.

- The importer copies matched files into `assets/inventory/` under a content-addressed name (e.g. `bo_00001-4caece539b.jpg`), so re-running does not create `-2`, `-3` duplicates, and replacing a photo produces a new path. `data/source/photos/` and `data/source/flyers/` are git-ignored source folders; only `assets/inventory/` is committed.
- If a file's name is not usable, the importer also looks for a `BO-xxxxx` code inside the image metadata (EXIF ImageDescription/UserComment/XMP, or PNG Description/Comment) and attaches it on a match. This lets a flyer generator stamp the code into the file without renaming it. Codes printed *in the pixels* are not read — that needs OCR; write the code into the metadata (or the filename) instead.
- **Embedded Excel images cannot be mapped to rows.** If the workbook has pictures floating over cells, export them (or screenshot the flyer) and name them by code, or list the filenames in the `foto` column.
- Use `--dry-run` to see which rows are missing an image before writing.
- Optimize before importing: WebP or JPEG around 1200px wide, under ~200 KB. Images are committed to the repo, so keep originals out of `data/`.
- Flyers with Spanish text on the EN page are flagged by the importer; add `flyer_en` if the English page should show English artwork.
- Cards without any image show a neutral placeholder with the product group; the list stays usable while photos are being added.

### Publishing workflow

1. Update the sheet, drop new photos/flyers in `data/source/photos/` or `data/source/flyers/`.
2. Run the importer (it prints skipped rows and warnings).
3. Review `data/inventory.json`, then commit `data/inventory.json` and `assets/inventory/`.
4. Reload the page. The section shows the new list; sold items disappear because only `disponible` rows are exported.
5. The public list is paginated in the browser (24 cards, “Ver más / Load more”) and has free-text search, category filters, a price range, and sorting by price, name, quantity, or newest; 1,320 items load from one JSON file.

When Kapso is wired up later, it can read this same `data/inventory.json` (or the database behind it) instead of the site being the source of truth.

## Running outside T3

The prototype has no T3 dependency. It needs Python 3.8+ (standard library only) and any static file server — no pip, no build step, no Node.

### Refresh stock and images

```bash
# Validate first (no files written)
python3 tools/import_inventory.py /path/to/workbook.xlsx --dry-run

# Rebuild the public inventory; images can live outside the repo
python3 tools/import_inventory.py /path/to/workbook.xlsx \
  --photos-dir /path/to/photos --flyers-dir /path/to/flyers
```

With `make` installed, the same commands are `make preview`, `make inventory`, and `make serve`. Override paths with `make inventory WORKBOOK=… ARGS="--photos-dir …"`. On Windows use `py -3` instead of `python3` and run the raw commands.

### Serve and deploy

```bash
python3 -m http.server 4173
# http://localhost:4173/index.html
```

Deploy by uploading the static files to any host (Netlify, Cloudflare Pages, GitHub Pages, nginx/Apache): `index.html`, `en.html`, `styles.css`, `script.js`, `inventory.js`, `data/inventory.json`, and `assets/`. There is no server-side code, and the site works under a subpath because all references are relative.

### What travels with the repo

- `data/inventory.json` and `assets/inventory/` are committed, so a fresh clone serves the current catalog without running Python.
- `data/source/photos/` and `data/source/flyers/` are git-ignored; a clone will not contain the originals. Keep them backed up separately, or always pass external `--photos-dir`/`--flyers-dir` paths.
- `fetch()` needs HTTP; opening `index.html` from the filesystem shows the empty state.

## Notes

- The live feeds and map require an internet connection and are subject to each platform's embed policies. If a feed is blocked, the direct profile link still works. Facebook and Instagram reels are embedded because their page/profile plugins currently omit or fail to render reels; update the reel URLs when a newer reel should be featured.
- Prices are optional and come from the inventory sheet; when a row has no price the card shows “Consultar precio / Ask price”. Availability is still confirmed through WhatsApp and in store.
- Product names in the current workbook are in English (U.S. retail brands), so both pages show them as-is until Spanish names are added to the sheet.
- The site is a static prototype; no build step is required.
