# CAPRI — incremento 7 + servidor etapa 1 (rama `incremento-7` = `servidor-etapa-1`)

**Para:** Efrain (revisa y hace merge) · **De:** Leo · **Base:** `incremento-6-final` = `a8f72f4` · **Punta:** `40af4c5`
Spec: "CAPRI — what's missing: spec for increments 6–8" (https://claude.ai/artifact/KviP4AsDfjQof7F5qF31sz), secciones 3, 4 y 6
(decisiones 6–11, aceptadas por Leo el 29/10/2026).

## Cómo traer las ramas (desde la sesión de Claude no se puede subir)

Un solo bundle trae las cuatro ramas (5, 6, 7 y servidor); necesita tu `main` (`2eedf21`), nada más:

```bash
cd ~/Documents/Claude/Projects/cotizador-helgen
B=entregas/incremento-7/capri-incrementos-5-6-7-servidor.bundle
git bundle verify "$B"                   # "is okay"
git fetch "$B" incremento-5:incremento-5 incremento-6-final:incremento-6 incremento-7:incremento-7 servidor-etapa-1:servidor-etapa-1
git checkout incremento-7
bash tests/todas.sh                      # 36 ✔; +9 del servidor si antes corriste: cd servidor && npm ci
git push github incremento-5 incremento-6 incremento-7 servidor-etapa-1   # GitHub; git.helgen.online es su espejo (solo lectura):
# https://git.helgen.online/leo/cotizador-helgen/settings → Sincronizar ahora (el servidor clona del espejo)
```

`incremento-6` ya trae el arreglo `a8f72f4` (la huella del pago parcial con `textoCelda`): sustituye al bundle `cabf985`.
Si el bundle no sirve: `git checkout -b incremento-7 a8f72f4 && git apply --index entregas/incremento-7/capri-incremento-7.diff`
(antes trae el 6 con su bundle).

## Qué trae

- **Gastos** `GAS-AAAA-NNNN` por proyecto: captura en el teléfono con foto del ticket (y XML opcional), categorías (Viáticos ·
  Combustible · Hospedaje · Casetas · Herramientas · Otros); **Aprobaciones** aprueba o rechaza, **Compras** reembolsa con
  comprobante. Nadie aprueba ni reembolsa lo suyo (super admin con motivo). Entran al margen (sin IVA; el ISH es costo).
- **Horas y nómina.** Hoja de horas semanal (pasos de 0.25 h, ≤ 24 h/día) que aprueba el **líder del proyecto** (o Aprobaciones);
  rol **Nómina** con el costo mensual por persona en un área privada nueva ("CAPRI — Nómina"); reparto por horas → nómina por
  proyecto (nunca por persona). Recordatorio los viernes.
- **Adicionales.** Cotización "Adicional" en un proyecto con contrato firmado, en su moneda, con su propio mini-esquema y su cobro;
  suma al contratado como línea aparte sin tocar el contrato.
- **Facturas de clientes (CFDI fase A).** Helgen timbra en **CONTALINK**; CAPRI importa los XML (uno, varios o el ZIP), los liga a
  etapas del contrato o de un adicional, y avisa REP pendientes (PPD cobrada sin su complemento de pago).
- **Margen completo:** contrato + adicionales − órdenes − gastos − nómina, igual en la tarjeta de cobranza, el resumen y
  Reportes → margen. Costos en otra moneda van en "Revisar" (nunca se suman MXN y USD).
- **Servidor propio, etapa 1** (`servidor/`, `docs/servidor-*.md`): el mismo `Code.js` en Node dentro de Docker en el servidor de
  Drogheda (`capri.helgen.online`). No cambia nada en Apps Script salvo la **costura `API_MUDADA`** en `doPost` (11 líneas; sin la
  propiedad no hace nada). `.claspignore` deja fuera `servidor/`.

## Revisión

Tres revisiones independientes del incremento ya integrado; todo lo encontrado se arregló con su prueba:

- **Dinero, monedas y estados** (`tests/revision7-dinero.test.js`, `docs/incremento-7.md` §5): ligas de facturas por clave y nombre de
  etapa (no se mueven solas; no se permite renumerar una etapa con facturas), un UUID en un solo registro entre gastos y facturas de
  proveedor, idempotencia de `registrarPago` en la hoja, saldo a favor aparte de "por cobrar", la moneda del proyecto no cambia con
  gastos vivos, REP en USD pagado en MXN y REP sustituidos, importes de nómina "45.000".
- **Permisos y privacidad** (`tests/revision7-privacidad.test.js`, §6): la nómina por proyecto en el margen de cobranza permitía
  deducir el costo de una persona → **oculta a cobranza por omisión** (Script Property `NOMINA_EN_MARGEN = cobranza` para mostrar
  solo el monto), versión de `costosPersonal` enmascarada, nadie se nombra líder, devolver horas aprobadas con huella y ventana;
  gastos sin HTTP dentro del candado; XSS por el XML de un gasto (ahora `text/plain` y vista segura); ISH; Helgen → Helgen.
- **Importación de facturas** (`tests/revision7-importar.test.js`, `docs/incremento-7-facturas.md` §7): ZIP revisado por su índice
  antes de inflar y límite por envío, un archivo malo ya no tumba el envío ni deja archivos huérfanos, regla 7 en todo texto del XML,
  REP solo MXN/USD, referencias del XML.

Al unir el servidor se encontró y corrigió una diferencia del arnés de pruebas con Apps Script (`base64EncodeWebSafe` sin relleno
`=`); la paridad servidor ↔ arnés da 31 de 31 llamadas idénticas con hojas, archivos, carpetas y correos iguales.
`VERSION_CODIGO_CACHE = 2026-10-29t`.

## Para publicar

`PUBLICAR-incremento-7.md` (misma carpeta). Publica 5, 6 y 7 juntos si el 5 aún no sale.

## Pendiente

- Manual del Cotizador (gastos, horas y nómina, adicionales, facturas de clientes, margen, `NOMINA_EN_MARGEN`).
- Reembolso o nota de crédito de un saldo a favor con proveedor (hoy solo se ve como pendiente).
- El flujo de 13 semanas no incluye reembolsos de gastos ni nómina.
- Los pasos de exportación de CONTALINK en `docs/incremento-7-facturas.md` son genéricos: confirmarlos con quien factura.
- Servidor: instalar y comprobar en el servidor real (`docs/servidor-comandos.md`, de A0 a E).
