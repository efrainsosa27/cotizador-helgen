# Pagos anteriores a la orden: excepción controlada

La regla normal no cambia: la fecha del pago no puede ser futura ni anterior a la OC. El caso excepcional es material cubierto antes de que se capturara la orden; no se corrige falsificando la fecha de la OC.

1. Compras elige la fecha real del pago y pulsa **Solicitar excepción de fecha**. Debe explicar el motivo (10 a 500 caracteres).
2. Un **super admin** encuentra las solicitudes en **Compras → Solicitudes de excepción de fecha**, o abre la orden. Puede autorizar o rechazar con un motivo que queda en bitácora. Tener Compras no permite autorizar excepciones.
3. Con una solicitud autorizada, Compras selecciona esa autorización al elegir la misma fecha y registra el pago con su comprobante y todos sus datos normales.
4. La autorización queda ligada a la OC, su fecha original, la fecha real del pago y quien la solicitó. Se consume en un pago; no sirve para otra orden ni otra fecha. Un reenvío del mismo pago sigue siendo idempotente.

La aprobación no registra el pago ni ejecuta una transferencia. El servidor vuelve a verificarla dentro del candado de escritura; un campo enviado desde el navegador no puede saltarse la regla. El saldo máximo, moneda, comprobante, documentos del proveedor y selección de tarjeta siguen validándose. El uso queda copiado en el pago y en la bitácora; cancelar ese pago no vuelve a habilitar la autorización.

Persistencia: pestaña ExcepcionesFechaPago del libro de Compras; nueva columna al final de PagosProveedores: `excepcion_fecha (JSON)`. Los pagos anteriores siguen leyéndose igual y la fecha de la orden no se modifica.

Prueba: `node tests/excepcion-fecha-pago.test.js .`. Incluye solicitud, rechazo, permisos, fecha futura, orden/fecha equivocada, uso único y reintentos del mismo pago.
