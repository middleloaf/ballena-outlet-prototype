PY ?= python3
WORKBOOK ?= data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx
PORT ?= 4173
ARGS ?=

.PHONY: inventory preview serve optimize-images dev deploy

# Rebuild data/inventory.json from the workbook (add ARGS="--photos-dir ..." if needed).
inventory:
	$(PY) tools/import_inventory.py $(WORKBOOK) $(ARGS)

# Same, but report only.
preview:
	$(PY) tools/import_inventory.py $(WORKBOOK) $(ARGS) --dry-run

# Serve the static site locally.
serve:
	$(PY) -m http.server $(PORT)

# Shrink the committed flyer copies (requires ImageMagick's mogrify).
optimize-images:
	@command -v mogrify >/dev/null 2>&1 || { echo "ImageMagick (mogrify) is required."; exit 1; }
	mogrify -resize '900x900>' -strip -interlace Plane -quality 82 assets/inventory/*.jpeg

# Cloudflare Worker (needs Node 22+ and `npm install`).
dev:
	npx wrangler dev

deploy:
	npx wrangler deploy
