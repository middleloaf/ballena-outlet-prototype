# Fotos de producto

Dejá acá las fotos de los artículos. El importador las copia a
`assets/inventory/` y las asocia a la fila del inventario.

## Cómo nombrarlas

La forma más simple es usar el código del producto como nombre:

```
BO-00001.jpg
BO-00002.jpg
BO-01320.jpg
```

También se aceptan sufijos: `BO-00001-frente.jpg`, `BO-00001-2.jpg`.
Formatos: JPG, PNG, WebP, AVIF, GIF.

Si tus archivos tienen nombres de cámara (`IMG_1234.jpg`), no hace falta
renombrarlos: agregá una columna `foto` en la hoja con el nombre exacto de
cada archivo y el importador lo busca por ese nombre.

## Código dentro de la imagen

Si el archivo no tiene un nombre útil, el importador busca un código
`BO-xxxxx` en los metadatos de la imagen (EXIF `ImageDescription`,
`UserComment`, XMP, o `Description`/`Comment` en PNG). Eso permite que el
generador de flyers estampe el código sin renombrar el archivo.

Ojo: WhatsApp e Instagram suelen borrar los metadatos al enviar la foto.
Si las imágenes pasan por el chat, usá el nombre del archivo.

## Antes de importar

- Convertí a WebP o JPEG de unos 1200 px de ancho y menos de ~200 KB.
- Las fotos se commitean al repo dentro de `assets/inventory/`; esta carpeta
  de origen no se commitea.
- Corré el importador desde la raíz del proyecto:

```bash
python3 tools/import_inventory.py data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx
```

Si existe esta carpeta, el importador la usa automáticamente. Para usar otra:
`--photos-dir ~/otra-carpeta`.

Los flyers van en `flyers/`, con las mismas reglas (o en las columnas
`flyer_es` / `flyer_en` de la hoja).

## Mapeo sin renombrar

Si preferís no renombrar las fotos, completá `map.csv` en esta carpeta:

```
archivo,codigo
IMG_1234.jpg,BO-00001
```

El importador copia el archivo y lo asocia a ese artículo.
