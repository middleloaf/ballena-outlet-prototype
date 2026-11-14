# Flyers de producto

Esta carpeta está en `data/source/flyers/`. Mismas reglas que `../photos/`:
nombrá los archivos con el código del producto (`BO-00001.jpg`) y el
importador los asocia a la fila correspondiente.

Un flyer se usa como imagen de la tarjeta solo cuando el artículo no tiene
foto, y siempre queda disponible con el botón “Ver flyer”. Los flyers suelen
tener texto incorporado, así que se muestran completos (letterbox), no
recortados.

Para la página en inglés podés agregar una columna `flyer_en` en la hoja con
el flyer en inglés; si no, se usa el de español.

Corré el importador desde la raíz del proyecto:

```bash
python3 tools/import_inventory.py data/source/Control_Inventario_Outlet_Ballena_Dos_Tiendas.xlsx
```

Más detalle en `../README.md`.
