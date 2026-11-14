#!/usr/bin/env python3
"""Build data/inventory.json from an inventory spreadsheet.

Usage:
    python3 tools/import_inventory.py data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx
    python3 tools/import_inventory.py inventario.csv --photos-dir ~/fotos --flyers-dir ~/flyers
    python3 tools/import_inventory.py inventario.xlsx --dry-run

Reads .xlsx (stdlib only, no openpyxl) or .csv. Only rows that are available
are published, and internal columns (cost, margin, notes) never reach the JSON.

The Ballena Outlet workbook ("STOCK TIENDAS" sheet) is understood directly:
Código, Producto, Cantidad manifiesto, Precio etiqueta, Conteo Tienda 1/2,
Conteo bodega, Total actual and Estado. Quantity prefers the physical counts,
then Total actual, then the manifest as a provisional fallback.
"""

import argparse
import csv
import hashlib
import io
import json
import re
import shutil
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "inventory.json"
IMAGE_DIR = ROOT / "assets" / "inventory"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

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
    "como_nuevo": ["como_nuevo", "like_new", "open_box", "caja_abierta", "exhibicion"],
    "usado": ["usado", "usada", "used", "segunda_mano", "segunda"],
    "para_partes": ["para_partes", "repuesto", "for_parts", "parts", "danado", "damaged"],
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
    "precio_crc": ["precio_crc", "precio", "precio_colones", "precio_es", "price", "price_crc",
                   "precio_venta", "precio_etiqueta"],
    "cantidad": ["cantidad", "qty", "stock", "unidades", "quantity"],
    "cantidad_manifiesto": ["cantidad_manifiesto", "manifiesto", "cantidad_original"],
    "conteo_t1": ["conteo_tienda_1", "conteo_t1", "conteo_tienda1"],
    "conteo_t2": ["conteo_tienda_2", "conteo_t2", "conteo_tienda2"],
    "conteo_bodega": ["conteo_bodega", "conteo_deposito"],
    "total_actual": ["total_actual", "total_actual_por_configurar", "actual_total"],
    "foto": ["foto", "foto_es", "photo", "imagen", "image", "imagen_es", "ruta_foto"],
    "flyer_es": ["flyer_es", "flyer", "flyer_sp", "flyer_espanol"],
    "flyer_en": ["flyer_en", "flyer_ingles", "flyer_english"],
    "estado": ["estado", "status", "disponibilidad", "estado_publicacion", "estado_por_configurar"],
}
COLUMN_LOOKUP = {alias: field for field, aliases in COLUMNS.items() for alias in aliases}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"}
USED_SOURCES = set()

# Keyword categories for sheets that do not carry a category column.
CATEGORY_RULES = [
    ("juguetes", ["lego", "playmobil", "pokemon", "pokémon", "pikachu", "tonies", "gigglescape", "board game",
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
                  "booster box", "launcher", "vehicle", "jet", "lankybox"]),
    ("electrodomesticos", ["refrigerator", "fridge", "microwave", "air fryer", "coffee maker", "espresso",
                           "blender", "toaster", "oven", "dishwasher", "washer", "dryer", "freezer", "kettle",
                           "griddle", "waffle maker", "slow cooker", "pressure cooker", "rice cooker",
                           "stand mixer", "hand mixer", "juicer", "food processor", "vacuum", "steam iron",
                           "humidifier", "air purifier", "fan", "heater", "slushi", "slushy", "shaved ice",
                           "drink maker", "soda maker", "ice maker", "range hood", "cooktop", "stove",
                           "dehydrator", "sous vide", "milk frother", "charging station", "water dispenser",
                           "popcorn", "side tank", "fryer", "cotton candy", "fountain", "ice cream", "ice pop",
                           "coffee machine", "water boiler", "egg cooker", "egg bite"]),
    ("textiles", ["rug", "rugs", "carpet", "towel", "towels", "blanket", "throw blanket", "pillow", "pillows",
                  "pillowcase", "duvet", "comforter", "sheet set", "bedding", "quilt", "curtain", "curtains",
                  "tablecloth", "table runner", "placemat", "napkin", "bath mat", "kitchen mat", "floor mat",
                  "doormat", "comfort mat", "mat", "mats", "tapestry", "bed skirt", "mattress pad", "coverlet",
                  "sham", "bath sheet", "bath towel", "hand towel", "washcloth"]),
    ("ropa", ["jacket", "shirt", "t-shirt", "tee", "pants", "jeans", "dress", "skirt", "sweater", "hoodie",
              "sweatshirt", "socks", "shoes", "sneakers", "boots", "sandals", "slippers", "underwear", "bra",
              "pajamas", "pajama", "coat", "vest", "scarf", "beanie", "gloves", "belt", "backpack", "handbag",
              "purse", "tote", "duffel", "luggage", "wallet"]),
    ("belleza", ["shampoo", "conditioner", "lotion", "moisturizer", "serum", "cleanser", "makeup", "mascara",
                 "lipstick", "foundation", "perfume", "cologne", "deodorant", "toothpaste", "toothbrush", "razor",
                 "hair dryer", "straightener", "curling iron", "skincare", "skin care", "sunscreen", "body wash",
                 "soap", "nail", "cosmetic", "beauty", "brush set", "face mask", "shaving"]),
    ("herramientas", ["drill", "saw", "hammer", "screwdriver", "wrench", "pliers", "tool set", "toolbox",
                      "tool box", "ladder", "hose", "garden", "planter", "shovel", "rake", "lawn", "mower",
                      "trimmer", "leaf blower", "workbench", "clamp", "level", "tape measure",
                      "watering can", "wheelbarrow", "pruner", "shears", "tool", "tools"]),
    ("electronica", ["headset", "headphone", "earbud", "speaker", "soundbar", "keyboard", "mouse", "monitor",
                     "webcam", "camera", "charger", "charging", "cable", "power bank", "tablet", "laptop",
                     "phone case", "tv", "television", "projector", "router", "smart home", "doorbell",
                     "chromecast", "roku", "gaming console", "controller", "playstation", "xbox", "nintendo",
                     "usb", "bluetooth", "wi-fi", "wifi", "printer", "hard drive", "ssd",
                     "memory card", "airtag", "tracker", "ring light", "microphone", "dash cam", "gps", "ps5",
                     "nintendo switch"]),
    ("hogar", ["cookware", "box", "pot", "pots", "pan", "pans", "skillet", "dutch oven", "saucepan", "frying pan",
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
               "filtration system", "towel rack", "ninjamas"]),
]
CATEGORY_OVERRIDES = [
    ("hogar", ["hammered", "diapers", "diaper", "caddy", "shelf", "shelves", "dish brush", "hand shower",
               "dutch oven", "towel rack", "ninjamas", "towel holder", "towel bar", "towel ring", "paper towel",
               "fridge drawer", "lunch tote", "lunch box"]),
    ("textiles", ["bath robe", "bath sheet", "bath towel", "hand towel", "washcloth"]),
]

# "Microwave & dishwasher safe" qualifiers describe care, not the product.
CARE_MASK = re.compile(
    r"\b(?:microwave|oven|dishwasher)(?:\s*(?:&|and|,)\s*(?:microwave|oven|dishwasher))*[\s-]*(?:and\s+)?safe\b",
    re.I,
)
SHORT_KEY = re.compile(r"^[a-z]{1,4}$")


def fold(value):
    """Lowercase, strip accents, collapse punctuation to underscores."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = text.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def keyword_match(text, key):
    if SHORT_KEY.match(key):
        return re.search(r"(?<![a-z])" + re.escape(key) + r"(?:s|es)?(?![a-z])", text) is not None
    return key in text


def guess_category(name):
    text = CARE_MASK.sub(" ", name).lower().replace("tabletop", "table top")
    for slug, keys in CATEGORY_OVERRIDES:
        for key in keys:
            if keyword_match(text, key):
                return slug
    for slug, keys in CATEGORY_RULES:
        for key in keys:
            if keyword_match(text, key):
                return slug
    return "otros"


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


def parse_int(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(round(value))
    text = str(value).strip()
    if not text:
        return None
    text = re.sub(r"[^\d.,-]", "", text)
    if not text:
        return None
    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", text):
        text = re.sub(r"[.,]", "", text)
    else:
        text = text.replace(",", ".")
    try:
        return int(round(float(text)))
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
    """Read the first rows of an .xlsx using only the standard library."""
    with zipfile.ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall(NS + "si"):
                shared.append("".join(node.text or "" for node in item.iter(NS + "t")))

        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {rel.get("Id"): rel.get("Target") for rel in relationships}
        sheets = [
            (sheet.get("name"), targets.get(sheet.get(REL_NS + "id")))
            for sheet in workbook.iter(NS + "sheet")
        ]
        if not sheets:
            raise SystemExit("El archivo no tiene hojas.")
        name, target = sheets[0]
        # Prefer the stock sheet when the workbook has one.
        for sheet_name, sheet_target in sheets:
            if "stock" in (sheet_name or "").lower():
                name, target = sheet_name, sheet_target
                break

        target = (target or "").lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target

        rows = []
        root = ET.fromstring(archive.read(target))
        for row in root.iter(NS + "row"):
            values = []
            for cell in row.findall(NS + "c"):
                ref = cell.get("r") or ""
                match = re.match(r"([A-Z]+)", ref)
                index = 0
                for char in (match.group(1) if match else "A"):
                    index = index * 26 + ord(char) - 64
                index -= 1
                kind = cell.get("t")
                node = cell.find(NS + "v")
                inline = cell.find(NS + "is")
                if kind == "s" and node is not None:
                    value = shared[int(node.text)]
                elif kind == "inlineStr" and inline is not None:
                    value = "".join(text.text or "" for text in inline.iter(NS + "t"))
                elif node is not None:
                    value = node.text
                else:
                    value = ""
                while len(values) <= index:
                    values.append("")
                values[index] = value
            rows.append(values)
        return rows


def load_rows(path):
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xlsm"}:
        return read_xlsx(path)
    if suffix in {".csv", ".tsv", ".txt"}:
        return read_csv(path)
    raise SystemExit(f"Formato no soportado: {path.suffix}. Usá .xlsx o .csv.")


def copy_image(source):
    """Copy into assets/inventory under a stable, content-addressed name.

    Re-importing the same photo reuses the same path; replacing it produces a
    new path instead of piling up "-2", "-3" copies on every run.
    """
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(source.read_bytes()).hexdigest()[:10]
    stem = fold(Path(source).stem) or "item"
    suffix = Path(source).suffix.lower()
    if suffix not in IMAGE_EXTS:
        suffix = ".jpg"
    target = IMAGE_DIR / f"{stem}-{digest}{suffix}"
    if not target.exists():
        shutil.copy2(source, target)
    USED_SOURCES.add(str(source.resolve()))
    return target.relative_to(ROOT).as_posix()


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


_METADATA_CACHE = {}


def embedded_code(path):
    """Read a BO-xxxxx code from image metadata, if the image carries one.

    Checks EXIF ImageDescription/UserComment/XMP and PNG Description/Comment
    text. Reading a code printed *in the pixels* would need OCR; this does not.
    """
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        with Image.open(path) as image:
            texts = []
            for key in ("Description", "Comment", "Title", "ImageDescription", "description", "comment", "title"):
                value = image.info.get(key)
                if value:
                    texts.append(value.decode("utf-8", "ignore") if isinstance(value, bytes) else str(value))
            exif = image.getexif()
            for tag in (270, 37510, 700):
                value = exif.get(tag)
                if value:
                    texts.append(value.decode("utf-8", "ignore") if isinstance(value, bytes) else str(value))
            for value in texts:
                match = re.search(r"\bBO-\d{5}\b", value, re.I)
                if match:
                    return match.group(0).upper()
    except Exception:
        return None
    return None


def metadata_index(directory):
    """Map product codes found in image metadata to their files."""
    key = str(directory)
    if key in _METADATA_CACHE:
        return _METADATA_CACHE[key]
    index = {}
    try:
        import PIL  # noqa: F401
    except ImportError:
        _METADATA_CACHE[key] = index
        return index
    for candidate in sorted(directory.iterdir()):
        if candidate.is_file() and candidate.suffix.lower() in IMAGE_EXTS:
            code = embedded_code(candidate)
            if code and code.lower() not in index:
                index[code.lower()] = candidate
    _METADATA_CACHE[key] = index
    return index


def find_by_code(directory, item_id):
    """Match files named after the product code, e.g. BO-00001.jpg."""
    if not directory:
        return None
    directory = Path(directory).expanduser()
    if not directory.is_dir():
        return None
    wanted = item_id.lower()
    # BO-00001.jpg, and BO-00001-front.jpg, but not BO-000010.jpg.
    pattern = re.compile(r"^" + re.escape(wanted) + r"(?![0-9])")
    for candidate in sorted(directory.iterdir()):
        if candidate.is_file() and candidate.suffix.lower() in IMAGE_EXTS and pattern.match(candidate.stem.lower()):
            return candidate

    # No filename match: try a code embedded in the image metadata.
    index = metadata_index(directory)
    return index.get(wanted)




def resolve_image(value, photos_dir, warnings, label):
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
            return copy_image(match)

    if source.is_file():
        try:
            return source.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            return copy_image(source)

    warnings.append(f"{label}: no se encontró la imagen '{value}' (se omite).")
    return None


def resolve_quantity(raw):
    counts = [raw.get(key) for key in ("conteo_t1", "conteo_t2", "conteo_bodega")]
    if any(str(value or "").strip() for value in counts):
        total = 0
        for value in counts:
            if str(value or "").strip():
                total += parse_int(value) or 0
        return total
    for field in ("total_actual", "cantidad_manifiesto", "cantidad"):
        if str(raw.get(field) or "").strip():
            value = parse_int(raw.get(field))
            if value is not None:
                return value
    return 1


def make_id(row, index):
    seed = f"{row.get('nombre_es', '')}|{row.get('precio_crc', '')}|{index}"
    return "item-" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:8]


def build(sheet_rows, photos_dir, flyers_dir, sample):
    warnings = []
    skipped = []
    items = []
    seen_ids = set()
    guessed = Counter()
    missing_en = 0

    if not sheet_rows:
        raise SystemExit("La hoja está vacía.")

    header = [fold(cell) for cell in sheet_rows[0]]
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
            skipped.append(f"{label}: {name_es[:60]} (estado: {status})")
            continue

        category = None
        if str(raw.get("categoria") or "").strip():
            category = CATEGORY_LOOKUP.get(fold(raw.get("categoria")))
            if not category:
                warnings.append(
                    f"{label}: categoría '{raw.get('categoria')}' no reconocida; se deduce del nombre."
                )
        if not category:
            category = guess_category(name_es)
            guessed[category] += 1

        condition = None
        if str(raw.get("condicion") or "").strip():
            condition = CONDITION_LOOKUP.get(fold(raw.get("condicion")))
            if not condition:
                warnings.append(f"{label}: condición '{raw.get('condicion')}' no reconocida (se omite).")

        price = parse_price(raw.get("precio_crc"))
        if str(raw.get("precio_crc") or "").strip() and price is None:
            warnings.append(f"{label}: precio '{raw.get('precio_crc')}' no es un número (se publica sin precio).")

        qty = resolve_quantity(raw)
        if qty <= 0:
            skipped.append(f"{label}: {name_es[:60]} (cantidad 0)")
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
            "qty": qty,
        }

        name_en = str(raw.get("nombre_en", "")).strip()
        if name_en:
            item["name_en"] = name_en
        else:
            missing_en += 1

        for field, key in (("detalle_es", "detail_es"), ("detalle_en", "detail_en")):
            value = str(raw.get(field, "")).strip()
            if value:
                item[key] = value

        if condition:
            item["condition"] = condition
        if price is not None:
            item["price_crc"] = price

        photo = resolve_image(raw.get("foto"), photos_dir, warnings, label)
        if not photo:
            match = find_by_code(photos_dir, item_id)
            if match:
                photo = copy_image(match)
        if photo:
            item["foto"] = photo

        flyer_es = resolve_image(raw.get("flyer_es"), flyers_dir, warnings, label)
        if not flyer_es:
            match = find_by_code(flyers_dir, item_id)
            if match:
                flyer_es = copy_image(match)
        if flyer_es:
            item["flyer_es"] = flyer_es

        flyer_en = resolve_image(raw.get("flyer_en"), flyers_dir, warnings, label)
        if flyer_en:
            item["flyer_en"] = flyer_en

        items.append(item)

    if missing_en:
        warnings.append(
            f"{missing_en} filas sin nombre en inglés; la página EN mostrará el nombre en español."
        )
    if guessed:
        detail = ", ".join(f"{slug}={count}" for slug, count in guessed.most_common())
        warnings.append(f"categorías deducidas del nombre del producto: {detail}")
    if any(item["category"] == "otros" for item in items):
        others = [item["name_es"] for item in items if item["category"] == "otros"]
        warnings.append(f"{len(others)} artículos quedaron en 'otros': " + "; ".join(others[:5]))

    return items, warnings, skipped, guessed


def report_unmatched(directory, label, hint):
    if not directory:
        return
    directory = Path(directory).expanduser()
    if not directory.is_dir():
        return
    unused = [
        candidate.name
        for candidate in sorted(directory.iterdir())
        if candidate.is_file() and candidate.suffix.lower() in IMAGE_EXTS
        and str(candidate.resolve()) not in USED_SOURCES
    ]
    if not unused:
        return
    print(f"  aviso    {len(unused)} imágenes en {label} no se asociaron a ningún artículo.")
    for name in unused[:5]:
        print(f"           · {name}")
    if len(unused) > 5:
        print(f"           · … y {len(unused) - 5} más")
    print(f"           {hint}")


def main():
    parser = argparse.ArgumentParser(description="Genera data/inventory.json desde una hoja de inventario.")
    parser.add_argument("source", help="Archivo .xlsx o .csv con el inventario.")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Ruta del JSON de salida.")
    parser.add_argument("--photos-dir", help="Carpeta de fotos de producto; por defecto data/source/photos/ si existe.")
    parser.add_argument("--flyers-dir", help="Carpeta de flyers; por defecto data/source/flyers/ si existe.")
    parser.add_argument("--sample", action="store_true", help="Marca el JSON como inventario de muestra.")
    parser.add_argument("--dry-run", action="store_true", help="Valida y muestra el resumen sin escribir.")
    args = parser.parse_args()

    source = Path(args.source).expanduser()
    if not source.is_file():
        raise SystemExit(f"No existe el archivo: {source}")

    photos_dir = args.photos_dir
    flyers_dir = args.flyers_dir
    if not photos_dir and (ROOT / "data" / "source" / "photos").is_dir():
        photos_dir = str(ROOT / "data" / "source" / "photos")
    if not flyers_dir and (ROOT / "data" / "source" / "flyers").is_dir():
        flyers_dir = str(ROOT / "data" / "source" / "flyers")

    rows = load_rows(source)
    items, warnings, skipped, guessed = build(rows, photos_dir, flyers_dir, args.sample)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sample": bool(args.sample),
        "count": len(items),
        "items": items,
    }

    print(f"Leídas: {max(0, len(rows) - 1)} filas · Publicadas: {len(items)} · Omitidas: {len(skipped)}")
    if photos_dir:
        print(f"  fotos:  {photos_dir}")
    if flyers_dir:
        print(f"  flyers: {flyers_dir}")
    if guessed:
        print("  categorías: " + ", ".join(f"{slug}={count}" for slug, count in guessed.most_common()))
    for line in skipped:
        print(f"  omitida  {line}")
    for line in warnings:
        print(f"  aviso    {line}")
    report_unmatched(
        photos_dir, "data/source/photos/",
        "Renombrá el archivo como BO-00001.jpg o agregá una columna 'foto' con el nombre exacto.",
    )
    report_unmatched(
        flyers_dir, "data/source/flyers/",
        "Renombrá el archivo como BO-00001.jpg o agregá una columna 'flyer_es' con el nombre exacto.",
    )

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
