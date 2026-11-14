# Flyers de producto

Mismas reglas que `photos/`: nombrá los archivos con el código del producto
(`BO-00001.jpg`) y el importador los asocia a la fila correspondiente.

Un flyer se usa como imagen de la tarjeta solo cuando el artículo no tiene
foto, y siempre queda disponible con el botón “Ver flyer”. Los flyers suelen
tener texto incorporado, así que se muestran completos (letterbox), no
recortados.

Para la página en inglés podés agregar una columna `flyer_en` en la hoja con
el flyer en inglés; si no, se usa el de español.

## Mapeo sin renombrar

`map.csv` ya lista los archivos de esta carpeta con la columna `codigo` vacía.
Completala con el código de cada artículo y el importador los asocia sin
renombrar nada:

```
archivo,codigo
WhatsApp Image 2026-11-12 at 11.37.25 AM.jpeg,BO-00001
```

Los códigos que no existan en el inventario se reportan al importar.
