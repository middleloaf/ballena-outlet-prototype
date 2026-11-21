# Ballena Outlet — bilingual storefront prototype

A Spanish/English website for **Ballena Outlet**, a liquidation store in Uvita, Costa Rica that buys pallets of customer returns, overstock, and unclaimed packages from major U.S. retailers and sells the items by the piece. This is the **second-version prototype**.

- **Spanish site:** `index.html` (Costa Rica flag / ES)
- **English site:** `en.html` (U.S. flag / EN)
- **Spanish catalog:** `inventario.html` (full searchable inventory)
- **English catalog:** `inventory.html` (full searchable inventory)
- **Shared design:** `styles.css`
- **Interactions:** `script.js` (mobile menu, reveals, FAQ behavior, feed labeling)
- **Assets:** `assets/` (storefront hero, real store photos, SVG brand logo, SVG favicon)

## Run locally

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173/index.html` (Spanish) or `http://localhost:4173/en.html` (English). The full catalog is at `http://localhost:4173/inventario.html` (Spanish) and `http://localhost:4173/inventory.html` (English).

## What's included

- Full bilingual copy with a persistent flag-based language switch.
- Store details: Plaza La Perla del Pacífico, next to Servicentro Ballena, upstairs from Farmacia Ballena, Uvita, Costa Rica.
- WhatsApp `6313 2925` shown on the main WhatsApp buttons, email `ballena.outletafacturacion@hotmail.com`, Facebook, Instagram, and TikTok links as buttons.
- Social feeds and buttons placed near the top. The feed order is Facebook, Instagram, TikTok. Facebook and Instagram show the latest reel because their page/profile plugins do not render reels reliably; TikTok uses the standalone embed iframe (avoids TikTok `embed.js` overload protection). Direct-profile fallbacks remain for all three.
- Real store photos in the “Un lugar real / A real place” section, with a provisional-photo disclaimer and a Google Maps location embed.
- Store pickup and in-store shipping messaging throughout; no online checkout.
- Product groups with clearer examples, how-it-works steps, value props, FAQ, and a mobile quick-action bar.
- A live “Disponible hoy / Available today” section on both home pages: a four-item preview that links to the full catalog. The catalog pages (`inventario.html` / `inventory.html`) have the complete searchable, filterable, sortable list, rendered from `data/inventory.json` (built from a spreadsheet, see below).
- A dismissible prototype popup in both languages that identifies the site as a second-version prototype, plus a detailed “About this prototype” section and `noindex` metadata so search engines do not treat the demo as final.

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

`data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx` is the store's real workbook. It is **git-ignored** (it carries internal cost sheets), so copy it into `data/source/` on each machine before rebuilding. The importer automatically picks the sheet whose name contains “stock” (`STOCK TIENDAS`) and reads:

`Código`, `Producto`, `Cantidad manifiesto`, `Precio etiqueta ₡`, `Conteo Tienda 1`, `Conteo Tienda 2`, `Conteo bodega`, `Total actual`, `Estado`.

- **Quantity** prefers the physical store counts. While those columns are empty it falls back to `Total actual`, then to `Cantidad manifiesto` as a provisional quantity, so the site can go live before the count is finished. Rows at 0 are hidden.
- **Price** is the tag price from the sheet. The 15% discount in `INVENTARIO ORIGINAL` is applied at the register, not on the site: the card shows the tag price, and that sheet (cost, base amount, discounted price) is not read, so internal figures never reach the public JSON.
- **Category** is inferred from the product name when the sheet has no category column; the import report prints the distribution and flags anything left in `otros`.
- **Photos/flyers** are matched by product code (`BO-00001.jpg`) when `--photos-dir`/`--flyers-dir` is given. Until photos exist, cards show a neutral placeholder with the product group, so the list is still usable.

`MOVIMIENTOS` and `VENTAS PREVIAS` are not used by the importer yet. The three prior sales listed in `VENTAS PREVIAS` are already reflected in the store counts, so they are not subtracted again.

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
- Optimize before importing: WebP or JPEG around 900–1200px on the long side, under ~200 KB. Images are committed to the repo, so keep originals out of `data/`.
- Flyers with Spanish text on the EN page are flagged by the importer; add `flyer_en` if the English page should show English artwork.
- Cards without any image show a neutral placeholder with the product group; the list stays usable while photos are being added.

### Publishing workflow

1. Update the sheet, drop new photos/flyers in `data/source/photos/` or `data/source/flyers/`.
2. Run the importer (it prints skipped rows and warnings).
3. Review `data/inventory.json`, then run `make optimize-images` (optional; needs ImageMagick) and commit `data/inventory.json` and `assets/inventory/`.
4. Reload the home page for the four-item preview, or the catalog page for the full list. Sold items disappear because only `disponible` rows are exported.
5. The catalog page paginates in the browser (24 cards, “Ver más / Load more”) and has free-text search, category filters, a price range, and sorting by featured items (image-first), inventory order, price, name, quantity, or newest; 1,320 items load from one JSON file. The home preview also prioritizes items that have a photo or flyer.

The Kapso WhatsApp bot reads the same data through the inventory API (see *Cloudflare deployment* below), so the bot and the site always agree on stock and prices.

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

With `make` installed, the same commands are `make preview`, `make inventory`, `make serve`, and `make optimize-images` (requires ImageMagick). Override paths with `make inventory WORKBOOK=… ARGS="--photos-dir …"`. On Windows use `py -3` instead of `python3` and run the raw commands.

### Serve and deploy

```bash
python3 -m http.server 4173
# http://localhost:4173/index.html
# http://localhost:4173/inventario.html
```

The static files also work on any plain host (nginx, GitHub Pages); only the `/api/*` inventory API needs the Cloudflare Worker.

## Cloudflare deployment

Production is one Cloudflare Worker (`ballena-outlet`) with static assets: https://ballena-outlet.leesalminen.workers.dev

- `wrangler.jsonc`: the repo root is the asset directory; `.assetsignore` keeps `tools/`, `data/source/`, `worker/`, docs and config out of the public bundle.
- `worker/index.js` runs only for `/api/*` (`run_worker_first`); pages and images are served from the asset store without invoking the Worker.
- Requires Node 22+ (`.node-version` pins 24). `npm install`, then `npm run dev` (http://localhost:8787) or `npm run deploy`.
- Auto-deploy: Workers Builds (Cloudflare dashboard → Workers & Pages → ballena-outlet → Settings → Build → Connect to Git). Pushes to `main` run `npx wrangler deploy`; other branches get preview URLs.

### Inventory API (for the Kapso bot)

Read-only, no auth (it exposes only what the public catalog already shows), CORS open, 60 s cache. Built from `data/inventory.json` at request time, so a re-import + push updates the bot too.

| Endpoint | Purpose |
|---|---|
| `GET /api/inventory/search?q=&category=&min_price=&max_price=&limit=&lang=` | In-stock items. `q` is word-prefix matched, accent-insensitive; items matching every word come first, otherwise partial matches. `limit` ≤ 50. |
| `GET /api/inventory/{id}` | One item by code (`BO-00071`). 404 = not in stock. |
| `GET /api/categories` | Categories with counts. |
| `GET /api/store` | Address, WhatsApp, email, purchase/pricing policy. |
| `GET /api/openapi.json` | OpenAPI 3.1 spec — import into Kapso as the bot's tools. |
| `GET /api/health` | Item count and import timestamp. |

Product names are English U.S. retail listings, so the bot must search with English keywords even when the customer writes Spanish. That is stated in the OpenAPI descriptions the bot's model reads; there is deliberately no synonym table in the Worker.

### What travels with the repo

- `data/inventory.json` and `assets/inventory/` are committed, so a fresh clone serves the current catalog without running Python.
- `data/source/photos/`, `data/source/flyers/`, and the `.xlsx` workbook are git-ignored; a clone will not contain the originals. Keep them backed up separately, or always pass external `--photos-dir`/`--flyers-dir` paths and the workbook's path. The committed `data/inventory.json` already serves the site without any of them.
- `fetch()` needs HTTP; opening `index.html` from the filesystem shows the empty state.

## Notes

- The live feeds and map require an internet connection and are subject to each platform's embed policies. If a feed is blocked, the direct profile link still works. Facebook and Instagram reels are embedded because their page/profile plugins currently omit or fail to render reels; update the reel URLs when a newer reel should be featured.
- Prices are optional and come from the inventory sheet; when a row has no price the card shows “Consultar precio / Ask price”. Availability is still confirmed through WhatsApp and in store.
- Product names in the current workbook are in English (U.S. retail brands), so both pages show them as-is until Spanish names are added to the sheet.
- The whole site is rendered at 93.75% visual scale using `zoom: 0.9375` on `html` in `styles.css`, which is 25% larger than the previous 75% preview. Change that value to adjust the global scale.
- The site is a static prototype; no build step is required.
