# CAPRI — incremento 6 + rapidez (rama `incremento-6`)

**Para:** Efrain (revisa y hace merge) · **De:** Leo · **Base:** `incremento-5` = `fd5c6d5` · **Punta:** `cabf985`
Spec: "CAPRI — what's missing: spec for increments 6–8" (https://claude.ai/artifact/KviP4AsDfjQof7F5qF31sz), secciones 1, 2 y 5.

## Cómo traer las ramas (desde la sesión de Claude no se puede subir: GitHub responde 403)

Primero la del incremento 5 (si no la tienes), luego esta:

```bash
git fetch entregas/incremento-5/capri-incremento-5-fd5c6d5.bundle incremento-5:incremento-5
git fetch entregas/incremento-6/capri-incremento-6-cabf985.bundle incremento-6-final:incremento-6
git checkout incremento-6
bash tests/todas.sh                      # 26 archivos + sintaxis de la interfaz, todo en verde
git push github incremento-5 incremento-6
```

Si el bundle no sirve: `git checkout -b incremento-6 fd5c6d5 && git apply --index entregas/incremento-6/capri-incremento-6.diff`.

## Qué trae

- **Pagos parciales a proveedores.** Varios pagos (`PGP-`) por orden hasta completar: anticipo, parcial, liquidación. Plan de pagos
  opcional al autorizar (concepto + %, suma 100). Saldo, siguiente pago y "Pagada parcial" (quien pidió solo ve la etiqueta, sin
  montos). Con cualquier pago se puede recibir; el pago que completa cierra. Tope: lo que se debe (neto de devoluciones y, con
  retenciones, lo facturado) + 1.00. Lo pagado de más queda como **saldo a favor** (nota de crédito o reembolso). Cuentas por pagar
  mide cada orden por su saldo y parte lo no facturado por etapa del plan.
- **Reportes** (pestaña nueva): antigüedad de CxC por cliente y proyecto, antigüedad de CxP por proveedor (con "saldo a favor" y
  "órdenes anteriores sin pago registrado" aparte), flujo de 13 semanas (cobros contra pagos, neto acumulado) y margen por proyecto
  y línea de negocio; cada uno con CSV. MXN y USD siempre aparte. Permisos: CxC y margen → cobranza; CxP → compras; flujo → super
  admin. **Fecha esperada por etapa** de cobranza (opcional, editable aun con contrato firmado; va a la bitácora).
- **Rapidez en Apps Script.** Menos lecturas a Sheets por petición (memo por petición, encabezados revisados cada 6 h, valores chicos
  del caché en una lectura). Medido con el perfil del arnés: abrir una requisición −49 %, pagar a proveedor −51 %, cotizar una
  requisición −55 %, sincronizar tras un cambio −71 %, activador de 15 min −83 %; respuestas idénticas a la versión anterior.
  Regla 18: toda escritura por `escribe_`, todo candado por `candado_`.

## Revisión

Tres revisiones independientes (pagos: dinero y estados; reportes y permisos; caché de la rapidez). Todo lo encontrado se arregló
con su prueba (`tests/pagos-revision.test.js`, `tests/revision6-reportes.test.js`, §11–§16 de `tests/rapidez.test.js`). Lo
principal: una factura con retenciones atoraba la requisición; la idempotencia del pago dependía del caché (con ~165 proveedores se
podía duplicar un pago) y ahora vive en la hoja; tope contra lo facturado; una sola cifra de CxP en Compras y Reportes; memos y
carreras del caché; claves de caché con espacio por versión de código (el código nuevo no sirve listas armadas por el viejo).
Fuzzers de pagos (600+ secuencias al azar) sin hallazgos; prueba en vivo contra el servidor real del centro de mando: 44 + 7 bien.

## Para publicar

`PUBLICAR-incremento-6.md` (misma carpeta). Va junto con el incremento 5 o después de él.

## Pendiente

- Manual del Cotizador (pagos parciales, Reportes, fechas esperadas, `VERSION_CODIGO_CACHE` al publicar).
- Registrar el reembolso o la nota de crédito de un saldo a favor (hoy solo aparece como pendiente de compras).
- REP por pago parcial de facturas PPD.
- `esc()` dentro de `onclick` fuera de los módulos nuevos (solo folios del servidor) → `jsArg`.
