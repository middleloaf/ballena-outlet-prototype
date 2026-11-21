# Archivos fuente del inventario

Todo lo que alimenta la sección “Disponible hoy / Available today” vive acá.
Nada de esta carpeta se publica tal cual: el importador lee estos archivos,
filtra lo que está disponible y genera `data/inventory.json`, que es lo único
que la web consume.

## Contenido

```
data/source/
├── Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx   Hoja de control (STOCK TIENDAS)
├── photos/                                              Fotos reales de producto
├── flyers/                                              Flyers con texto incorporado
├── README.md                                            Esta guía
└── README.en.md                                         Nota temporal en inglés (se puede borrar)
```

Las fotos, los flyers y la hoja de cálculo **no se commitean**: solo se
commitean las copias que el importador deja en `assets/inventory/` y el
`data/inventory.json` generado. La hoja se mantiene local (o respaldada aparte)
y se copia a `data/source/` en cada equipo antes de reimportar.

## Cómo se asocian las imágenes

El nombre del archivo debe ser el código del artículo:

```
photos/BO-00001.jpg
flyers/BO-00317.jpeg
```

También se aceptan sufijos (`BO-00001-frente.jpg`, `BO-00001-2.jpg`) y las
extensiones JPG, PNG, WebP, AVIF y GIF.

Si el archivo no tiene un nombre útil, el importador busca un código
`BO-xxxxx` en los metadatos de la imagen (EXIF `ImageDescription`,
`UserComment`, XMP, o `Description`/`Comment` en PNG). WhatsApp e Instagram
suelen borrar esos metadatos, así que si las imágenes llegan por chat, hay que
renombrarlas.

Los archivos que no se asocian se listan al importar, con el nombre exacto,
para que sea fácil corregirlos.

## Fotos y flyers

- **Foto**: imagen real del artículo. Es la imagen principal de la tarjeta.
- **Flyer**: imagen de marketing con texto incorporado (marca, precio,
  especificaciones). Se usa como imagen de tarjeta solo si el artículo no
  tiene foto, y siempre queda disponible con el botón “Ver flyer”. Se muestra
  completa, sin recortar, para no perder el texto.
- Un artículo puede tener foto y flyer a la vez.
- Para la página en inglés se puede agregar una columna `flyer_en` en la hoja;
  si no existe, se usa el flyer en español.

## Publicar cambios

1. Guardá la hoja de cálculo (si está abierta en LibreOffice/Excel, guardá
   antes de importar; el importador lee la última versión guardada).
2. Poné las fotos o flyers nuevos en `photos/` o `flyers/`, con el código como
   nombre.
3. Corré, desde la raíz del proyecto:

```bash
node tools/import-inventory.mjs data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx --dry-run
node tools/import-inventory.mjs data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx
```

4. Revisá el reporte: artículos publicados, omitidos, avisos y archivos sin
   asociar.
5. Reiniciá o recargá la página. Solo se publican las filas con estado
   `disponible`; las columnas internas (costo, proveedor, notas) nunca llegan
   al JSON público.

## Qué columnas se leen

De la hoja `STOCK TIENDAS`: `Código`, `Producto`, `Cantidad manifiesto`,
`Precio etiqueta ₡`, `Conteo Tienda 1`, `Conteo Tienda 2`, `Conteo bodega`,
`Total actual` y `Estado`.

- La cantidad publicada prioriza los conteos físicos; mientras estén vacíos
  usa `Total actual` y, como último recurso, `Cantidad manifiesto`.
- El precio es el de etiqueta. Las hojas internas (`INVENTARIO ORIGINAL` con
  costo y descuento) no se leen.
- La categoría se deduce del nombre del producto cuando la hoja no la trae.

## Antes de importar imágenes

- Convertí a WebP o JPEG de unos 900–1200 px del lado más largo y menos de ~200 KB.
- No hace falta borrar las imágenes viejas de `assets/inventory/`: cada copia
  tiene un nombre basado en su contenido, así que reimportar no duplica
  archivos.
