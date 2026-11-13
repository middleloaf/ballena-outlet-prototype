#!/usr/bin/env python3
"""Turn an inventory spreadsheet into the public catalog used by the website.

Usage:
    python3 tools/import_inventory.py data/inventory.sample.csv --sample
    python3 tools/import_inventory.py inventario.xlsx --photos-dir ~/Downloads/fotos
    python3 tools/import_inventory.py inventario.csv --dry-run

Reads .xlsx (needs openpyxl) or .csv, validates the rows, and writes
data/inventory.json. Only rows whose estado is "disponible" are published.
Internal columns (cost, supplier, notes) are never written to the JSON.
"""

import argparse
import csv
import hashlib
import io
import json
import re
import shutil
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "inventory.json"
IMAGE_DIR = ROOT / "assets" / "inventory"

# Categories must match the product groups already used on the site.
CATEGORIES = {
    "electrodomesticos": ["electrodomesticos", "electrodomestico", "linea_blanca", "appliances", "appliance"],
    "hogar": ["hogar", "casa", "home", "cocina", "menaje", "kitchen"],
    "textiles": ["textiles", "alfombras", "alfombra", "tapetes", "textiles_y_alfombras", "rugs", "textile"],
    "juguetes": ["juguetes", "juguete", "ninos", "juguetes_y_ninos", "toys", "toy"],
    "electronica": ["electronica", "electronicos", "electronics", "tecnologia", "technology"],
    "belleza": ["belleza", "cuidado_personal", "belleza_y_cuidado_personal", "beauty", "cosmetica", "cosmetics"],
    "herramientas": ["herramientas", "jardin", "ferreteria", "herramientas_y_jardin", "tools", "garden"],
    "ropa": ["ropa", "calzado", "ropa_y_calzado", "apparel", "clothing", "shoes"],
}
CATEGORY_LOOKUP = {alias: slug for slug, aliases in CATEGORIES.items() for alias in aliases}

CONDITIONS = {
    "nuevo": ["nuevo", "new", "nueva", "sellado", "sealed"],
    "como_nuevo": ["como_nuevo", "como_nuevo_caja_abierta", "like_new", "open_box", "caja_abierta", "exhibicion"],
    "usado": ["usado", "usada", "used", "segunda_mano", "segunda"],
    "para_partes": ["para_partes", "para_partes_o_repuesto", "repuesto", "for_parts", "parts", "danado", "damaged"],
}
CONDITION_LOOKUP = {alias: slug for slug, aliases in CONDITIONS.items() for alias in aliases}

PUBLISHED_STATUS = {"disponible", "available", "activo", "publicado", "published"}

COLUMNS = {
    "id": ["id", "sku", "codigo", "codigo_item", "item_id"],
    "nombre_es": ["nombre_es", "nombre", "producto", "articulo", "nombre_producto", "item"],
    "nombre_en": ["nombre_en", "name_en", "english_name", "nombre_ingles"],
    "detalle_es": ["detalle_es", "detalle", "descripcion_es", "descripcion", "description_es"],
    "detalle_en": ["detalle_en", "descripcion_en", "description_en", "description"],
    "categoria": ["categoria", "categoria_es", "category", "grupo", "tipo", "rubro"],
    "condicion": ["condicion", "condicion_fisica", "estado_fisico", "condition"],
    "precio_crc": ["precio_crc", "precio", "precio_colones", "precio_es", "price", "price_crc", "precio_venta"],
    "cantidad": ["cantidad", "qty", "stock", "unidades", "quantity"],
    "foto": ["foto", "foto_es", "photo", "imagen", "image", "imagen_es", "ruta_foto"],
    "flyer_es": ["flyer_es", "flyer", "flyer_sp", "flyer_espanol"],
    "flyer_en": ["flyer_en", "flyer_ingles", "flyer_english"],
    "estado": ["estado", "status", "disponibilidad", "estado_publicacion"],
}
COLUMN_LOOKUP = {alias: field for field, aliases in COLUMNS.items() for alias in aliases}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"}


def fold(value):
    """Lowercase, strip accents, collapse punctuation to underscores."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = text.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def normalize_header(value):
    return fold(value)


def parse_price(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(round(value))
    text = str(value or "").strip()
    if not text:
        return None
    text = re.sub(r"[^\d.,]", "", text)
    if not text:
        return None
    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", text):
        return int(re.sub(r"[.,]", "", text))
    try:
        return int(round(float(text.replace(",", "."))))
    except ValueError:
        return None


def parse_qty(value):
    if value is None or str(value).strip() == "":
        return 1
    try:
        return max(0, int(float(str(value).replace(",", "."))))
    except ValueError:
        return None


def read_csv(path):
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise SystemExit(f"No se pudo leer {path} como texto UTF-8 ni Latin-1.")

    first_line = text.splitlines()[0] if text.splitlines() else ""
    delimiter = ","
    try:
        delimiter = csv.Sniffer().sniff(first_line, delimiters=",;\t").delimiter
    except csv.Error:
        counts = {d: first_line.count(d) for d in (",", ";", "\t")}
        delimiter = max(counts, key=counts.get) if max(counts.values()) else ","

    return list(csv.reader(io.StringIO(text, newline=""), delimiter=delimiter))


def read_xlsx(path):
    try:
        from openpyxl import load_workbook
    except ImportError:
        raise SystemExit(
            "Para leer .xlsx hace falta openpyxl:\n"
            "    pip install openpyxl\n"
            "También podés abrir el archivo en Excel y guardarlo como CSV UTF-8."
        )

    workbook = load_workbook(path, data_only=True, read_only=True)
    sheet = workbook.active
    rows = []
    for row in sheet.iter_rows(values_only=True):
        rows.append(["" if cell is None else cell for cell in row])
    workbook.close()
    return rows


def load_rows(path):
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xlsm"}:
        return read_xlsx(path)
    if suffix in {".csv", ".tsv", ".txt"}:
        return read_csv(path)
    raise SystemExit(f"Formato no soportado: {path.suffix}. Usá .xlsx o .csv.")


def resolve_image(value, photos_dir, warnings, label):
    """Return a repo-relative image path, copying it in when photos_dir is given."""
    if value is None or str(value).strip() == "":
        return None
    raw = str(value).strip().replace("\\", "/")
    if re.match(r"^https?://", raw):
        return raw

    source = Path(raw).expanduser()
    if not source.is_absolute():
        candidate = ROOT / source
        if candidate.is_file():
            return candidate.relative_to(ROOT).as_posix()
        source = IMAGE_DIR / source.name

    if photos_dir:
        match = find_photo(photos_dir, Path(raw).name)
        if match:
            IMAGE_DIR.mkdir(parents=True, exist_ok=True)
            target = unique_target(sanitize_name(match.name))
            shutil.copy2(match, target)
            return target.relative_to(ROOT).as_posix()

    if source.is_file():
        try:
            return source.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            # Absolute path outside the repo: copy it into assets/inventory.
            IMAGE_DIR.mkdir(parents=True, exist_ok=True)
            target = unique_target(sanitize_name(source.name))
            shutil.copy2(source, target)
            return target.relative_to(ROOT).as_posix()

    warnings.append(f"{label}: no se encontró la imagen '{value}' (se omite).")
    return None


def find_photo(directory, name):
    directory = Path(directory).expanduser()
    if not directory.is_dir():
        return None
    exact = directory / name
    if exact.is_file():
        return exact
    wanted = name.lower()
    for candidate in directory.iterdir():
        if candidate.is_file() and candidate.name.lower() == wanted:
            return candidate
    return None


def sanitize_name(name):
    stem = fold(Path(name).stem) or "item"
    suffix = Path(name).suffix.lower()
    if suffix not in IMAGE_EXTS:
        suffix = ".jpg"
    return f"{stem}{suffix}"


def unique_target(name):
    target = IMAGE_DIR / name
    if not target.exists():
        return target
    stem, suffix = target.stem, target.suffix
    index = 2
    while True:
        candidate = IMAGE_DIR / f"{stem}-{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def make_id(row, index):
    seed = f"{row.get('nombre_es', '')}|{row.get('precio_crc', '')}|{index}"
    return "item-" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:8]


def build(sheet_rows, photos_dir, sample):
    warnings = []
    skipped = []
    items = []
    seen_ids = set()

    if not sheet_rows:
        raise SystemExit("La hoja está vacía.")

    header = [normalize_header(cell) for cell in sheet_rows[0]]
    fields = [COLUMN_LOOKUP.get(name) for name in header]
    if "nombre_es" not in fields:
        raise SystemExit(
            "Falta la columna de nombre. Se acepta 'nombre_es', 'nombre', 'producto' o 'articulo'.\n"
            f"Encabezados leídos: {', '.join(str(h) for h in sheet_rows[0])}"
        )

    for row_number, values in enumerate(sheet_rows[1:], start=2):
        if not any(str(v).strip() for v in values):
            continue

        raw = {}
        for field, value in zip(fields, values):
            if field and str(value).strip():
                raw[field] = value

        label = f"fila {row_number}"
        name_es = str(raw.get("nombre_es", "")).strip()
        if not name_es:
            warnings.append(f"{label}: sin nombre en español (se omite).")
            continue

        status = fold(raw.get("estado", "disponible")) or "disponible"
        if status not in PUBLISHED_STATUS:
            skipped.append(f"{label}: {name_es} (estado: {status or 'sin estado'})")
            continue

        category_raw = fold(raw.get("categoria", ""))
        category = CATEGORY_LOOKUP.get(category_raw)
        if not category:
            warnings.append(
                f"{label}: categoría '{raw.get('categoria', '')}' no reconocida; se publica como 'otros'."
            )
            category = "otros"

        condition_raw = fold(raw.get("condicion", ""))
        condition = CONDITION_LOOKUP.get(condition_raw)
        if not condition:
            warnings.append(
                f"{label}: condición '{raw.get('condicion', '')}' no reconocida; se publica como 'usado'."
            )
            condition = "usado"

        price = parse_price(raw.get("precio_crc"))
        if raw.get("precio_crc") not in (None, "") and price is None:
            warnings.append(f"{label}: precio '{raw.get('precio_crc')}' no es un número (se publica sin precio).")

        qty = parse_qty(raw.get("cantidad"))
        if qty is None:
            warnings.append(f"{label}: cantidad inválida; se asume 1.")
            qty = 1
        if qty == 0:
            skipped.append(f"{label}: {name_es} (cantidad 0)")
            continue

        item_id = str(raw.get("id", "")).strip() or make_id(raw, row_number)
        if item_id in seen_ids:
            warnings.append(f"{label}: id duplicado '{item_id}' (se omite).")
            continue
        seen_ids.add(item_id)

        item = {
            "id": item_id,
            "name_es": name_es,
            "category": category,
            "condition": condition,
            "qty": qty,
        }

        name_en = str(raw.get("nombre_en", "")).strip()
        if name_en:
            item["name_en"] = name_en
        elif not sample:
            warnings.append(f"{label}: sin nombre en inglés; la versión EN mostrará el español.")

        for field, key in (("detalle_es", "detail_es"), ("detalle_en", "detail_en")):
            value = str(raw.get(field, "")).strip()
            if value:
                item[key] = value

        if price is not None:
            item["price_crc"] = price

        for field in ("foto", "flyer_es", "flyer_en"):
            path = resolve_image(raw.get(field), photos_dir, warnings, label)
            if path:
                item[field] = path

        if item.get("flyer_es") and not item.get("flyer_en") and not sample:
            warnings.append(
                f"{label}: flyer en español sin versión en inglés; la página EN usará el flyer en español."
            )

        items.append(item)

    items.sort(key=lambda entry: (entry["category"], entry["name_es"].lower()))
    return items, warnings, skipped


def main():
    parser = argparse.ArgumentParser(description="Genera data/inventory.json desde una hoja de inventario.")
    parser.add_argument("source", help="Archivo .xlsx o .csv con el inventario.")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Ruta del JSON de salida.")
    parser.add_argument(
        "--photos-dir",
        help="Carpeta con las fotos/flyers; los archivos referenciados se copian a assets/inventory/.",
    )
    parser.add_argument("--sample", action="store_true", help="Marca el JSON como inventario de muestra.")
    parser.add_argument("--dry-run", action="store_true", help="Valida y muestra el resumen sin escribir.")
    args = parser.parse_args()

    source = Path(args.source).expanduser()
    if not source.is_file():
        raise SystemExit(f"No existe el archivo: {source}")

    rows = load_rows(source)
    items, warnings, skipped = build(rows, args.photos_dir, args.sample)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sample": bool(args.sample),
        "count": len(items),
        "items": items,
    }

    print(f"Leídas: {max(0, len(rows) - 1)} filas · Publicadas: {len(items)} · Omitidas: {len(skipped)}")
    for line in skipped:
        print(f"  omitida  {line}")
    for line in warnings:
        print(f"  aviso    {line}")

    if args.dry_run:
        print("Dry run: no se escribió nada.")
        return

    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Escrito: {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}")

    if not items:
        print("Aviso: no quedó ningún artículo publicado; la web mostrará el estado vacío.")


if __name__ == "__main__":
    main()
