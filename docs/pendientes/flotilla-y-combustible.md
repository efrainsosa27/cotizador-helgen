# Siguiente módulo: flotilla y combustible

Solicitud de Leo: registrar vehículos, solicitar y autorizar gasolina, y saber con qué tarjeta se pagó. Se retoma después del cambio a /home y el registro de tarjetas. No está implementado ni publicado como módulo de flotilla.

## Flujo propuesto

1. Alta de vehículo: identificador interno, placa, marca/modelo, tipo de combustible, estado activo, sitio/proyecto y responsable. Conservar historial al reasignar o desactivar.
2. Solicitud de combustible: vehículo, conductor, odómetro, litros o importe solicitado, moneda, sitio/proyecto, motivo y fecha. Evidencia del odómetro cuando corresponda.
3. Autorización por Aprobaciones: límite de importe/litros, fecha de vigencia, observación y quién autorizó. Separar solicitante y aprobador, con excepción de super admin justificada en bitácora como en requisiciones.
4. Registro de carga real: estación, fecha, litros, precio por litro, total, odómetro, ticket/CFDI y tarjetaId del registro de Compras; guardar una copia de sus datos parciales como en pagos a proveedores. Permitir efectivo cuando aplique.
5. Conciliación por Compras/Tania: autorizado frente a consumido, diferencia justificada, comprobante y estado. Evitar tickets o envíos duplicados. Esta autorización registra el flujo interno; no controla el portal de la financiera ni ejecuta cargos reales.
6. Reportes: gasto por vehículo, conductor, proyecto, tarjeta y periodo; litros/100 km o km/l solo cuando existan lecturas consecutivas válidas. Alertas por odómetro regresivo o consumo atípico sin bloquear cargas legítimas a ciegas.

## Decisiones que faltan

- Quién puede pedir por cada vehículo y quién administra las altas.
- Topes de gasolina, vigencia y si admiten cargas sin autorización previa por emergencia.
- Si tienen tarjetas físicas compartidas, tarjetas de combustible o un portal del proveedor; integrar el mecanismo real solo con sus datos.
- Cómo manejar diésel para maquinaria, combustible en bidones y lecturas sin odómetro.

## Base lista

El catálogo de tarjetas identifica alias, banco, crédito/débito, últimos cuatro dígitos, titular y activo. No contiene números completos, CVV, NIP, vencimiento de tarjeta ni imágenes. El selector de pagos a proveedores usa tarjetas activas del tipo elegido y guarda la identificación histórica en cada pago. Reutilizar esa referencia en las cargas de combustible. No crear números, tarjetas ni vehículos ficticios en producción.
