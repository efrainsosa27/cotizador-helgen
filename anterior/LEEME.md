# Código del proyecto anterior (EN DESUSO desde el 19/10/2026)

Proyecto Apps Script `1X-qSKgvqKwuDj4iPZBhXlakR5udau9ibVMevhwvlLXgtSkjV4IoQxqwU` ("Cotizador Helgen (código de la app)").
Este es el código de la versión **@9** (la última que usó el equipo). Se guarda solo como referencia y para poder regresar.

- El deployment `AKfycbxahS3PbizPrRrQIC1m2uz-2G8PoT64BqPdtGLu0Ms5t9RKs2ucxH_c3tpJXkj8uLE` está en **@10**:
  muestra "El cotizador se mudó" y `guardarCotizacion` / `guardarProducto` lanzan error (para que solo un proyecto escriba en la hoja).
- **Regresar (solo si hace falta):** primero apuntar SPREADSHEET_ID, FOLDER_ID y CATALOGO_ID del proyecto nuevo a los IDs de prueba (no borrarlas: crearía otra base de datos), luego, desde esta carpeta:
  `npx clasp deploy --deploymentId AKfycbxahS3PbizPrRrQIC1m2uz-2G8PoT64BqPdtGLu0Ms5t9RKs2ucxH_c3tpJXkj8uLE -V 9 -d "regreso a @9"`
- No usar `clasp push` desde aquí salvo para ese regreso. Nunca correr los dos proyectos guardando a la vez.
