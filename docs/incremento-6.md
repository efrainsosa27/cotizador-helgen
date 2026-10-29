# CAPRI — incremento 6: contrato entre módulos (29/10/2026)

Spec aprobado por Leo con sus valores por omisión: "CAPRI — what's missing: spec for increments 6–8" (Claude Docs,
https://claude.ai/artifact/KviP4AsDfjQof7F5qF31sz), secciones 1, 2 y 6 (decisiones 1–5). Dos módulos en paralelo sobre
`incremento-6-base` (= `incremento-5` + este archivo):

| Módulo | Sección de `Code.js` | Interfaz | Qué |
|---|---|---|---|
| **P · Pagos parciales** | §6.P (`modPagosParciales_()` o cambios en compras) | pago a proveedor, orden, Cuentas por pagar | varios pagos por orden, plan de pagos, saldo, antigüedad de CxP con saldos |
| **R · Reportes** | §6.R (`modReportes_()`) | `<script id="mod-reportes">`, pestaña **Reportes** | antigüedad de CxC, flujo de 13 semanas, margen por proyecto, CSV; fecha esperada por etapa |

## 1. Lo que P publica y R usa (función pura, sin servicios de Google)

```js
/**
 * Saldo de una orden de compra. orden = {folio, moneda, total, estado, ...} (ordenDesdeFila_), pagos = filas de
 * PagosProveedores de ESA orden (cualquier estado), movimientos = MovimientosInventario de la orden (para lo devuelto sin
 * reponer, regla del incremento 5: totalPorPagarOrden + devueltoSinReponer).
 * → {esperado, pagado, saldo, completo, vigentes: [{folio, fecha, montoAplicado, tipo}], siguiente: {concepto, monto,
 *    vence} | null}
 * esperado = totalPorPagarOrden(orden, devueltoSinReponer(movimientos)); pagado = Σ monto_aplicado de los pagos Vigentes
 * (en la moneda de la orden); saldo = max(0, esperado − pagado) redondeado a centavos; completo = saldo ≤ TOLERANCIA_PAGO.
 * siguiente = lo que toca según el plan de pagos de la orden (si tiene), si no el saldo.
 */
function saldoOrdenCompra(orden, pagos, movimientos) { … }
```

R la llama para el lado de pagos del flujo de efectivo. Mientras P no esté en la rama de R, R la simula en sus pruebas con la
firma de arriba; al integrar se usa la de P.

## 2. Reglas de P (decisiones 1–3)

- Una orden acepta **varios pagos** (`PGP-`) hasta `completo`; un pago que dejaría `pagado > esperado + TOLERANCIA_PAGO` se
  rechaza. Comprobante, método, guardia de tarjeta y bloqueo de transferencia sin documentos: igual que hoy, en cada pago.
- Columna nueva en `PagosProveedores`: **`tipo`** = `Anticipo` (antes de recibir), `Parcial` o `Liquidación` (el que la completa).
  Columnas nuevas en `OrdenesCompra`: **`plan_pago`** (JSON `[{concepto, porcentaje}]`, opcional, suma 100) que se captura al
  autorizar.
- **Sin estado nuevo de orden ni de requisición.** La orden sigue `Emitida` hasta quedar `completo` (entonces `Pagada`, o se
  cierra si ya se recibió). La interfaz muestra la etiqueta derivada **"Pagada parcial"** cuando `0 < pagado` y no `completo`;
  el solicitante también la ve, sin montos.
- **Con cualquier pago Vigente el material se puede recibir** (decisión 1): `recibeAntesDePagar_(orden)` también es verdadero
  cuando la orden tiene pagos y no está completa. Así se reutiliza todo el camino del crédito del proveedor (Recibida con la
  orden sin pagar; el pago que la completa la cierra).
- **Centro de mando** (decisión 2): el primer pago Vigente manda `oc.pagada` (sin montos); los siguientes no mandan nada.
  Cancelar el último pago Vigente de una orden no recibida regresa el estado del portal como hoy al cancelar el pago.
- **Cancelar un pago** (motivo) cancela ese pago y recalcula; no se puede si la requisición está Cerrada (regla de hoy).
- **Cuentas por pagar** (`antiguedadCxp`): hoy deja fuera toda orden con algún pago; con P, una orden con saldo sigue en CxP por
  su saldo, con vencimiento por factura (fecha + días de crédito) o por el `siguiente` del plan.

## 3. Reglas de R (decisiones 4–5)

- **Fecha esperada por etapa** de cobranza: columna nueva `fecha_esperada` en `Esquemas` (opcional, editable por cobranza aun
  con contrato firmado, porque no cambia montos; va a la Bitácora).
- Pestaña **Reportes** con: **antigüedad de CxC** (por cliente y proyecto: no vencido, 1–30, 31–60, 61–90, > 90; sin fecha =
  "sin fecha"), **antigüedad de CxP** (la de P, misma presentación), **flujo de 13 semanas** (cobros esperados por etapa con
  fecha vs pagos esperados por saldo y vencimiento; neto acumulado) y **margen por proyecto** (contratado sin IVA − órdenes
  no canceladas; por línea de negocio). **MXN y USD siempre aparte.** Cada reporte con su CSV.
- Permisos (decisión 5): CxC y margen → cobranza; CxP → compras; flujo → super admin; super admin ve todo. Compras nunca ve
  montos de contrato ni margen. El servidor revisa el rol en cada llamada.
- Solo lectura; sin escrituras salvo `fecha_esperada`. Usa el caché por colección que ya existe (`cambios`).

## 4. Para los dos

- Español de México en interfaz, comentarios y commits; una prueba por regla; `bash tests/todas.sh` en verde.
- Reglas de `CLAUDE.md` §7: montos recalculados en el servidor, nunca sumar MXN y USD, nada de HTTP ni correos dentro del
  candado, cada función nueva que escribe declara sus `cambios`.
- Cada módulo deja `docs/incremento-6-<modulo>.md` con lo que cambió (hojas, columnas, funciones, pruebas, publicación).
