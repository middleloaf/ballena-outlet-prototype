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

# Import the real sheet and copy its photos/flyers into assets/inventory/
python3 tools/import_inventory.py inventario.xlsx --photos-dir ~/Downloads/fotos

# Validate without writing anything
python3 tools/import_inventory.py inventario.xlsx --dry-run
```

Reading `.xlsx` needs `pip install openpyxl`; otherwise open the sheet in Excel and save it as **CSV UTF-8**. Serve the site over HTTP (`python3 -m http.server 4173`) — `fetch()` cannot read `data/inventory.json` from `file://`.

### Sheet columns

One row per item. Header names are matched accent- and case-insensitively; these are accepted:

| Field | Accepted headers | Notes |
|---|---|---|
| ID | `id`, `sku`, `codigo` | Generated from the name if empty. Duplicates are dropped. |
| Spanish name | `nombre_es`, `nombre`, `producto`, `articulo` | Required. |
| English name | `nombre_en`, `name_en` | Optional; the EN page falls back to Spanish and the import warns. |
| Details | `detalle_es`, `detalle_en` | Optional, clamped to two lines. |
| Category | `categoria`, `category`, `grupo` | Must map to the site's groups: `electrodomesticos`, `hogar`, `textiles`, `juguetes`, `electronica`, `belleza`, `herramientas`, `ropa`. Unknown values are published as `otros` with a warning. |
| Condition | `condicion`, `estado_fisico`, `condition` | `nuevo`, `como_nuevo`, `usado`, `para_partes` (English synonyms accepted). |
| Price | `precio_crc`, `precio`, `price` | Optional integer colones. Empty = “Consultar precio”. |
| Quantity | `cantidad`, `stock`, `qty` | 0 hides the row; >1 shows “N disponibles”. |
| Photo | `foto`, `photo`, `imagen` | Filename or repo path. With `--photos-dir` the file is copied to `assets/inventory/`. |
| Flyers | `flyer_es`, `flyer_en` | AI flyers with baked-in text; the ES page prefers `flyer_es`, the EN page `flyer_en` then falls back. Shown in a lightbox. |
| Status | `estado`, `status`, `disponibilidad` | Only `disponible`/`available` is published; `reservado`, `vendido`, `oculto` are skipped and listed in the import report. |

Any other column (cost, supplier, internal notes) is ignored and never reaches the public JSON.

### Photos and flyers

- Put product photos in `assets/inventory/` (the importer creates it). Keep the sheet's image column to filenames, not embedded pictures — embedded Excel images can't be matched to rows reliably.
- The grid uses the clean product photo. A flyer is used as the card image only when there is no photo, and is always available through “Ver flyer”. Flyers are often 4:5 or 9:16 with text, so they are letterboxed rather than cropped.
- Flyers with Spanish text on the EN page are flagged by the importer; add `flyer_en` if the English page should show English artwork.
- Optimize images before importing (WebP/JPEG around 1200px wide) so the page stays fast.

### Publishing workflow

1. Update the sheet, drop new photos/flyers in a folder.
2. Run the importer (it prints skipped rows and warnings).
3. Review `data/inventory.json`, then commit `data/inventory.json` and `assets/inventory/`.
4. Reload the page. The section shows the new list; sold items disappear because only `disponible` rows are exported.

When Kapso is wired up later, it can read this same `data/inventory.json` (or the database behind it) instead of the site being the source of truth.

## Notes

- The live feeds and map require an internet connection and are subject to each platform's embed policies. If a feed is blocked, the direct profile link still works. Facebook and Instagram reels are embedded because their page/profile plugins currently omit or fail to render reels; update the reel URLs when a newer reel should be featured.
- Prices are optional and come from the inventory sheet; when a row has no price the card shows “Consultar precio / Ask price”. Availability is still confirmed through WhatsApp and in store.
- The site is a static prototype; no build step is required.
