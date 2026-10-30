# Proveedores, documentos e inventario · 30-oct-2026

En Compras hay un acceso visible a **Proveedores y documentos**. Una ficha puede darse de alta sin expediente completo; la lista muestra CSF, carátula y comprobante de domicilio faltantes. Los requisitos de pago vigentes se conservan. Los bancos y documentos permanecen en el libro/carpeta privada de Compras.

Las órdenes y las solicitudes de cotización permiten seleccionar un proveedor activo del catálogo y completar los datos existentes. Las cotizaciones de venta conservan su cliente: no se sustituye un cliente por un proveedor. La carga de datos por el proveedor será una etapa posterior; no se habilitaron enlaces públicos.

El catálogo de inventario de Drogheda recibe solo nombre, activo e identificador opaco SHA-256 del id de CAPRI. No se envían RFC, contacto, correo, banco, cuenta, CLABE, documentos ni sus ligas. Al guardar se intenta sincronizar; si falla, se conserva la ficha y se informa el pendiente. Se reintenta cada quince minutos o mediante el botón de sincronizar. Los proveedores dados de alta automáticamente al emitir una OC entran en el siguiente sondeo.

Para el despliegue, `prepararProveedoresDeOrdenes(false)` cuenta proveedores ausentes de las órdenes vigentes. `true` crea únicamente esas fichas y registra bitácora; no reemplaza ni completa con supuestos una ficha existente ni inventa documentos. Repetirlo no duplica registros. Son funciones de administración local, fuera de la API pública. Respaldar antes la pestaña Proveedores. Publicar primero el receptor Drogheda y después CAPRI; sincronizar y verificar la lista. Apps Script sigue bloqueado con API_MUDADA: no se publica un segundo escritor.
