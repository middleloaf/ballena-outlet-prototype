# Fotos de producto

Esta carpeta está en `data/source/photos/`. Dejá acá las fotos reales de los
artículos; el importador las copia a `assets/inventory/` y las asocia a la
fila del inventario.

## Nombre del archivo

Usá el código del producto:

```
BO-00001.jpg
BO-00002.jpg
BO-01320.jpg
```

Se aceptan sufijos (`BO-00001-frente.jpg`, `BO-00001-2.jpg`) y formatos JPG,
PNG, WebP, AVIF y GIF.

Si tus archivos tienen nombres de cámara (`IMG_1234.jpg`), no hace falta
renombrarlos: agregá una columna `foto` en la hoja con el nombre exacto de
cada archivo y el importador lo busca por ese nombre.

## Código dentro de la imagen

Si el nombre no sirve, el importador busca un código `BO-xxxxx` en los
metadatos (EXIF `ImageDescription`, `UserComment`, XMP, o
`Description`/`Comment` en PNG). WhatsApp e Instagram suelen borrar esos
metadatos, así que si la foto llegó por chat, renombrala.

## Antes de importar

- Convertí a WebP o JPEG de unos 1200 px de ancho y menos de ~200 KB.
- Corré el importador desde la raíz del proyecto:

```bash
python3 tools/import_inventory.py data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx
```

Si esta carpeta existe, el importador la usa automáticamente. Para usar otra:
`--photos-dir ~/otra-carpeta`.

Los flyers van en `../flyers/`. Más detalle en `../README.md`.
