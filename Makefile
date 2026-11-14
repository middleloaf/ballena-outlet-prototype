PY ?= python3
WORKBOOK ?= data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx
PORT ?= 4173
ARGS ?=

.PHONY: inventory preview serve

# Rebuild data/inventory.json from the workbook (add ARGS="--photos-dir ..." if needed).
inventory:
	$(PY) tools/import_inventory.py $(WORKBOOK) $(ARGS)

# Same, but report only.
preview:
	$(PY) tools/import_inventory.py $(WORKBOOK) $(ARGS) --dry-run

# Serve the static site locally.
serve:
	$(PY) -m http.server $(PORT)
