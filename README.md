# Ballena Outlet — bilingual storefront prototype

A Spanish/English website for **Ballena Outlet**, a liquidation store in Uvita, Costa Rica that buys pallets of customer returns, overstock, and unclaimed packages from major U.S. retailers and sells the items by the piece. This is the **v3 prototype**.

- **Spanish site:** `index.html` (Costa Rica flag / ES)
- **English site:** `en.html` (U.S. flag / EN)
- **Spanish catalog:** `inventario.html` (full searchable inventory)
- **English catalog:** `inventory.html` (full searchable inventory)
- **Shared design:** `styles.css`
- **Interactions:** `script.js` (mobile menu, reveals, feed labeling)
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
- Real store photos in the merged “Tienda y contacto / Store & contact” section, with a provisional-photo disclaimer and a single visit panel combining address, hours, contact channels, and a Google Maps embed.
- Store pickup, layaway (30% down payment, up to 1 month to pay the balance), and shipping messaging throughout; no online checkout.
- Product groups with clearer examples, how-it-works steps, store details including a “Good to know” note, and a mobile quick-action bar.
- A live “Disponible hoy / Available today” section on both home pages: a four-item preview that links to the full catalog. The catalog pages (`inventario.html` / `inventory.html`) have the complete searchable, filterable, sortable list, rendered from `data/inventory.json` (built from a spreadsheet, see below).
- A dismissible prototype popup in both languages that identifies the site as the v3 prototype, plus a detailed “About this prototype” section and `noindex` metadata so search engines do not treat the demo as final.

## Admin panel (inventory management)

`/admin/` lets the store manage inventory without git. Everything runs on the Workers free plan (no payment method needed).

- **Upload the workbook** (`.xlsx`/`.csv`). It is parsed **in the browser** by the same `worker/importer.js`; only the public columns are sent. The free plan allows ~10 ms CPU per request and parsing a 1,300-row workbook takes ~150 ms, so the server validates the resulting payload instead of parsing. The upload becomes a **draft** with a report: added, removed, price/quantity/image changes, skipped rows and warnings.
- **Photos and flyers**: drag in images. The code comes from the filename (`BO-00071.jpg`), the image metadata, or a field per row. Photos over 1.5 MB are shrunk to 1600 px in the browser. Images for codes not yet in the inventory are kept and attach on the next import.
- **Quick edits**: price, quantity, mark sold. These go into the draft; the next workbook upload replaces the whole inventory, so the sheet must be updated too. Marking an item as sold shows an **Undo** action in the notice, and the draft review (*Estado → Se quitan de la web*) keeps an Undo button for every removed item; undo restores the item, with its photos and details, to the draft.
- **Publish** sends the reviewed draft id. The server refuses a draft that changed after review or was built on an older version. **History** lists every published version; *Restore* makes a draft from one.
- The help section is the workbook/image guide from `data/source/README.md`.

**Storage** (`worker/store.js`):
- D1 `ballena-inventory` (`migrations/`) holds `state` rows `live` (served verbatim as `/data/inventory.json`), `draft` and `images`, plus `versions`, `admins` and `login_failures`.
- KV `MEDIA` holds product images, served at `/assets/inventory/*` (falling back to static assets for local CLI imports).
- Read-modify-write uses a per-row `rev` (compare-and-swap). Publishing inserts the version row (primary key) and updates `live` in one transaction.

**Auth** (`worker/auth.js`): email + password (PBKDF2-SHA256, 20k iterations to fit the CPU budget) and an HMAC-signed `HttpOnly; Secure; SameSite=Strict` session cookie (30 days).
- Every request re-checks the account in D1, so deleting it revokes access.
- Failed logins are limited to 8 per 15 minutes per email and per IP.
- Cross-site writes are refused.

```bash
npm run admin:account -- person@example.com            # create / change password (prompts)
npm run admin:account -- person@example.com --remove   # revoke
npx wrangler secret put SESSION_SECRET                 # rotate: logs everyone out
npm run db:migrate                                     # apply new migrations to production D1
```

**Admin API** (`/api/admin/*`, session cookie):

| Route | Purpose |
|---|---|
| `POST login` / `POST logout`, `GET whoami` | Session |
| `GET status`, `GET items?q=`, `GET versions` | Live summary, draft review, item search, history |
| `GET images` | Image index used by the browser importer |
| `POST import` | `{payload, report, filename}` from the browser importer |
| `POST edits` | `{ops: [{op: "set_price" \| "set_quantity" \| "remove" \| "restore" \| "set_fields" \| "add", ...}]}`. `restore` undoes a removal: `{op: "restore", id}` copies the published item back into the draft (or pass the full `item` for an item that only existed in the draft). |
| `POST images` | Multipart `file`, optional `code`, `kind=foto\|flyer_es\|flyer_en` |
| `POST images/remove`, `POST draft/discard` | Undo an image, drop the draft |
| `POST publish` | `{draft_id}` |
| `POST restore` | `{version}` |

Local dev: `npx wrangler d1 migrations apply ballena-inventory --local`, put `SESSION_SECRET=<64 hex>` in `.dev.vars`, then `npm run admin:account -- you@example.com --local` and `npm run dev`.

## Inventory from a spreadsheet

The available-items section reads `data/inventory.json`. **The repository ships a 24-item sample inventory** (`data/inventory.sample.csv` → `data/inventory.json`, flagged `sample: true`, shown with an “Inventario de muestra” badge). The store's real inventory and product images live only in production (D1 + KV) and are managed from the admin panel (below); `tools/import-inventory.mjs` builds the committed fallback file locally from an Excel/CSV sheet; nothing is typed into the HTML.

```bash
# Try the demo data (24 sample items, marked as sample in the UI)
node tools/import-inventory.mjs data/inventory.sample.csv --sample

# Import the store's workbook (STOCK TIENDAS sheet)
node tools/import-inventory.mjs data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx

# Photos go in data/source/photos/, flyers in data/source/flyers/; the importer picks them up automatically
node tools/import-inventory.mjs data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx

# Validate without writing anything
node tools/import-inventory.mjs inventario.xlsx --dry-run
```

The importer (`worker/importer.js`) is shared by the admin panel and the local CLI, so both apply identical rules. Serve the site over HTTP (`python3 -m http.server 4173`) — `fetch()` cannot read `data/inventory.json` from `file://`.

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
| Spanish search words | `buscar_es`, `buscar`, `palabras_es`, `keywords_es` | Optional, comma/semicolon-separated hidden aliases (for example `refri, nevera, refrigeradora`). They are never displayed; the importer also generates aliases from the product name, category, and the curated glossary in `worker/search-es.js`. |
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
   `node tools/import-inventory.mjs data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx`.
   The importer uses `data/source/photos/` and `data/source/flyers/` automatically when those folders exist; `--photos-dir`/`--flyers-dir` point it elsewhere. Suffixes such as `BO-00001-front.jpg` are accepted too.
2. **Per row.** Add a `foto` column to the sheet with the exact filename (`IMG_1234.jpg`) or a repo path, and put that file in `data/source/photos/` (or pass `--photos-dir`). This is the option when camera files are not renamed.

Flyers work the same way: either `flyer_es` / `flyer_en` columns with filenames, or `--flyers-dir ~/flyers` with code-named files. A flyer is only used as the card image when there is no photo; it is always available through “Ver flyer”.

- The importer copies matched files into `assets/inventory/` under a content-addressed name (e.g. `bo_00001-4caece539b.jpg`), so re-running does not create `-2`, `-3` duplicates, and replacing a photo produces a new path. `data/source/photos/` and `data/source/flyers/` are git-ignored source folders; only `assets/inventory/` is committed.
- If a file's name is not usable, the importer also looks for a `BO-xxxxx` code inside the image metadata (EXIF ImageDescription/UserComment/XMP, or PNG Description/Comment) and attaches it on a match. This lets a flyer generator stamp the code into the file without renaming it. Codes printed *in the pixels* are not read — that needs OCR; write the code into the metadata (or the filename) instead.
- **Embedded Excel images cannot be mapped to rows.** If the workbook has pictures floating over cells, export them (or screenshot the flyer) and name them by code, or list the filenames in the `foto` column.
- Use `--dry-run` to see which rows are missing an image before writing.
- Optimize before importing: WebP or JPEG around 900–1200px on the long side, under ~200 KB. Product images are not committed; in production they are uploaded through the admin panel.
- Flyers with Spanish text on the EN page are flagged by the importer; add `flyer_en` if the English page should show English artwork.
- Cards without any image show a neutral placeholder with the product group; the list stays usable while photos are being added.

### Publishing workflow

1. Update the sheet, drop new photos/flyers in `data/source/photos/` or `data/source/flyers/`.
2. Run the importer (it prints skipped rows and warnings).
3. Review `data/inventory.json` locally. Do not commit real inventory or product images: production is updated from `/admin/`.
4. Reload the home page for the four-item preview, or the catalog page for the full list. Sold items disappear because only `disponible` rows are exported.
5. The catalog page paginates in the browser (24 cards, “Ver más / Load more”) and has free-text search, category filters, a price range, and sorting by featured items (image-first), inventory order, price, name, quantity, or newest; 1,320 items load from one JSON file. The home preview also prioritizes items that have a photo or flyer.

The Kapso WhatsApp bot reads the same data through the inventory API (see *Cloudflare deployment* below), so the bot and the site always agree on stock and prices.

## Running outside T3

The prototype has no T3 dependency. It needs Node 22+ (`npm install` once) for the importer and Wrangler; serving the static pages only needs any file server.

### Refresh stock and images

```bash
# Validate first (no files written)
node tools/import-inventory.mjs /path/to/workbook.xlsx --dry-run

# Rebuild the public inventory; images can live outside the repo
node tools/import-inventory.mjs /path/to/workbook.xlsx \
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

Production is one Cloudflare Worker (`ballena-outlet`) with static assets: https://ballena-outlet.elliottvarnold.workers.dev (Elliott's Cloudflare account, pinned via `account_id` in `wrangler.jsonc`)

- `wrangler.jsonc`: the repo root is the asset directory; `.assetsignore` keeps `tools/`, `data/source/`, `worker/`, docs and config out of the public bundle.
- `worker/index.js` runs only for `/api/*` (`run_worker_first`); pages and images are served from the asset store without invoking the Worker.
- Requires Node 22+ (`.node-version` pins 24). `npm install`, then `npm run dev` (http://localhost:8787) or `npm run deploy`.
- Auto-deploy: Workers Builds (Cloudflare dashboard → Workers & Pages → ballena-outlet → Settings → Build → Connect to Git). Pushes to `main` run `npx wrangler deploy`; other branches get preview URLs.

### Inventory API (for the Kapso bot)

Read-only, no auth (it exposes only what the public catalog already shows), CORS open, 60 s cache. Built from the published inventory at request time, so a publish from `/admin/` updates the bot within a minute.

| Endpoint | Purpose |
|---|---|
| `GET /api/inventory/search?q=&category=&min_price=&max_price=&limit=&lang=` | In-stock items. `q` is word-prefix matched, accent-insensitive, and also searches the hidden Spanish aliases; items matching every word come first, otherwise partial matches. `limit` ≤ 50. |
| `GET /api/inventory/{id}` | One item by code (`BO-00071`). 404 = not in stock. |
| `GET /api/categories` | Categories with counts. |
| `GET /api/store` | Address, WhatsApp, email, purchase/pricing policy. |
| `GET /api/openapi.json` | OpenAPI 3.1 spec — import into Kapso as the bot's tools. |
| `GET /api/health` | Item count and import timestamp. |

Product names are English U.S. retail listings, but every item also carries hidden Spanish search aliases generated at import time (`search_es`). The bot and the site can search with Spanish keywords such as `refrigeradora`, `nevera`, or `freidora de aire`; the aliases are not shown on cards. The glossary lives in `worker/search-es.js`, and a sheet can add per-item aliases with the `buscar_es` column.

### What travels with the repo

- `data/inventory.json` is the **sample** inventory, so a fresh clone (or a static host such as GitHub Pages) shows a working demo catalog. Production serves the last version published from `/admin/` (D1); the committed file is never used there once a version exists. Regenerate it with `node tools/import-inventory.mjs data/inventory.sample.csv --sample`.
- `data/source/photos/`, `data/source/flyers/`, and the `.xlsx` workbook are git-ignored; a clone will not contain the originals. Keep them backed up separately, or always pass external `--photos-dir`/`--flyers-dir` paths and the workbook's path. The committed `data/inventory.json` already serves the site without any of them.
- `fetch()` needs HTTP; opening `index.html` from the filesystem shows the empty state.

## Notes

- The live feeds and map require an internet connection and are subject to each platform's embed policies. If a feed is blocked, the direct profile link still works. Facebook and Instagram reels are embedded because their page/profile plugins currently omit or fail to render reels; update the reel URLs when a newer reel should be featured.
- Prices are optional and come from the inventory sheet; when a row has no price the card shows “Consultar precio / Ask price”. Availability is still confirmed through WhatsApp and in store.
- Product names in the current workbook are in English (U.S. retail brands), so both pages show them as-is until Spanish names are added to the sheet.
- The whole site is rendered at 93.75% visual scale using `zoom: 0.9375` on `html` in `styles.css`, which is 25% larger than the previous 75% preview. Change that value to adjust the global scale.
- The site is a static prototype; no build step is required.
