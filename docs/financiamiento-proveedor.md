# Proveedor cubierto por financiera

En Registrar pago, «Crédito / financiera (proveedor cubierto)» registra evidencia de que un tercero cubrió al proveedor. No hace transferencias ni entra a portales. Exige comprobante y referencia como los otros métodos. No usarlo solo por disponer de una línea de crédito: el proveedor debe haber sido cubierto.

Guarda la financiera, el plazo (90 días por omisión), la fecha confirmada del desembolso y el vencimiento. Los datos desconocidos quedan vacíos y visibles como pendientes; no se inventa una fecha de vencimiento. Compras (incluida Tania) puede completarlos mediante «Editar financiamiento» en el pago o en Cuentas por pagar. Los cambios dejan bitácora y no alteran el importe ni la evidencia original.

El pago cubre el saldo del proveedor y conserva una deuda con la financiera por el principal, en la moneda del pago. Se muestra aparte en Cuentas por pagar y entra a Reportes de CxP y flujo. Sin vencimiento confirmado aparece sin fecha. No calcula intereses ni administra abonos a la financiera; liquidar esa deuda requiere extender el registro de financiamiento con sus propios comprobantes. No debe usarse la cancelación del pago al proveedor como comprobante de liquidación a la financiera.

La columna nueva es «financiamiento (JSON)», al final de PagosProveedores. No modifica posiciones anteriores. Los pagos anteriores se leen sin financiamiento. La idempotencia incluye los datos del financiamiento y rechaza reenvíos con otros datos. Cancelar/anular el pago excluye su financiamiento igual que el resto del registro.

## Operación por SSH

Drogheda-ops es una llave con comando forzado; no ofrece una shell y por eso no sirve como conexión persistente en Codex. Usar `ssh Drogheda-ops ayuda` para el menú existente de Drogheda. No cambia permisos de CAPRI.

El menú separado `capri-ops` se instala con `sudo bash servidor/despliegue/instalar-capri-ops.sh`. Admite solo estado, salud y reiniciar del contenedor fijo capri; no admite comandos, argumentos adicionales, rutas, despliegues ni una shell. Se invoca mediante la conexión normal: `ssh Drogheda 'sudo -n /usr/local/bin/capri-ops salud'`. Mantener la conexión Drogheda normal en Codex.

## Anular pruebas

Super admin: Administración → Anular / registros anulados → folio → Ver qué arrastra. Revisar toda la cascada y el motivo antes de confirmar. No borrar filas ni reutilizar folios. En este despliegue no se anula ni paga automáticamente REQ-2026-0004 ni ningún registro relacionado.
