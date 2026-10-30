# CAPRI: Home y registro de tarjetas

La interfaz canónica vive en `web/home/index.html` y se publica como https://capri.helgen.online/home/. La antigua /cotizador/ redirige con su query y fragmento; la sesión del mismo dominio se conserva. El nginx actualizado envía la raíz directamente a /home/. Antes de aplicar esa configuración, el nginx anterior envía / a /cotizador/ y la página de compatibilidad termina en /home/.

Compras → Tarjetas de crédito y débito permite que Compras (incluida Tania) registre, edite y desactive tarjetas con alias, banco, tipo, últimos cuatro dígitos y titular opcional. Es registro de identificación, no bóveda de credenciales ni carga de fotos de tarjetas. El servidor rechaza campos desconocidos, números completos y últimos cuatro dígitos inválidos. Las modificaciones dejan bitácora.

Los pagos nuevos por tarjeta exigen elegir una tarjeta activa del tipo correspondiente. Guardan una copia de sus datos parciales, para que una edición posterior no cambie el histórico. Las tarjetas inactivas quedan disponibles en el catálogo e histórico, pero no se pueden seleccionar para pagos nuevos. Los pagos anteriores sin tarjeta identificada siguen siendo legibles. No se asigna una tarjeta por adivinación a registros existentes.

El catálogo se guarda en la pestaña Tarjetas del libro privado de Compras. La identificación histórica se agrega al final de PagosProveedores, sin cambiar posiciones previas ni datos existentes. No se hacen cargos reales ni se registran tarjetas ficticias durante el despliegue.

Pruebas: `node tests/tarjetas.test.js .` y `bash tests/todas.sh`. En la nueva prueba se verifican permisos, identificadores mínimos, selección obligatoria, tipo, duplicados, idempotencia del pago, desactivación e histórico inalterado.

Flotilla y combustible: ver `docs/pendientes/flotilla-y-combustible.md` (siguiente módulo; todavía no implementado).
