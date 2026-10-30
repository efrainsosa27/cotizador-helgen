# CAPRI — incremento 7: contrato entre módulos (29/10/2026)

Spec aprobado por Leo (todas las decisiones "Accepted" el 29/10/2026): "CAPRI — what's missing: spec for increments 6–8"
(https://claude.ai/artifact/KviP4AsDfjQof7F5qF31sz), secciones 3, 4 y 6 (decisiones 6–11). Facturas de clientes: **Helgen timbra
en CONTALINK** (su PAC); CAPRI **importa el XML** (fase A), no timbra. Cuatro módulos en paralelo sobre `incremento-7-base`
(= `incremento-6-final` + este archivo):

| Módulo | Sección de `Code.js` | Interfaz | Qué |
|---|---|---|---|
| **G · Gastos** | §6.G `modGastos_()` | `<script id="mod-gastos">` | gastos por proyecto `GAS-AAAA-NNNN`: captura (teléfono), aprobación, reembolso |
| **N · Horas y nómina** | §6.N `modNomina_()` | `<script id="mod-horas">` | hoja de horas semanal, líder de proyecto, rol **Nómina**, costo mensual por persona y reparto por horas |
| **A · Adicionales** | §6.A `modAdicionales_()` | `<script id="mod-adicionales">` | cotización "Adicional" en un proyecto con contrato firmado, su esquema y su cobro |
| **C · Facturas de clientes** | §6.C `modFacturasClientes_()` | `<script id="mod-facturas">` | importar XML de CFDI (uno, varios o ZIP de CONTALINK), ligarlos a etapas, REP pendientes |

Cada módulo se registra en `MODULOS_` (una línea; el integrador resuelve el choque) y declara su `api`, `cambios`, `solo`,
`bootstrap`, `sincronizar` y `preparar` como los del incremento 4. Nada de listas globales a mano.

## 0. Puntos compartidos (cambios mínimos, cada uno anotado en su doc; el integrador une los choques)

| Qué | G | N | A | C |
|---|---|---|---|---|
| Colección nueva al final de `COLECCIONES` | `gastos` | `horas`, `costosPersonal` | `adicionales` | `facturasClientes` |
| `PREFIJOS_ANULAR` / cascada de Anular | `GAS` → `gasto` | — (horas no se anulan: se devuelven) | adicional = la cotización HLG (ya es `cotizacion`): su cascada cancela la fila de `Adicionales` y su esquema | — (se marca Cancelada) |
| Pendientes (`itemsPendientes`) | por aprobar · por reembolsar | horas por aprobar (líder) | — | REP pendientes · XML sin ligar |
| Otro | — | `ROLES_CAPRI`, `NOMBRES_ROLES`, `ENCABEZADOS_PROYECTOS` (`lider_email`) | `ENCABEZADOS_COTIZACIONES` (`tipo`), `guardarCotizacion`, `HOJAS_COBRANZA` (`Adicionales`, `Esquemas.adicional`), `resumenCobranza`/`vistaCobranza_` | `HOJAS_COBRANZA` (`FacturasClientes`), lector de CFDI de cliente |

- **No cambiar la salida de `leerCfdi`** (la usan las facturas de proveedor y G; agregar un campo sí: la revisión del 29/10/2026 agregó
  `locales`, §5). C agrega una función pura propia
  (`leerCfdiCliente(texto)` = `leerCfdi` + `relacionados: [{uuid, tipoRelacion}]` de `CfdiRelacionados` y, para tipo P,
  `pagos: [{fecha, monto, moneda, documentos: [{uuid, parcialidad, saldoAnterior, pagado, saldoInsoluto, moneda}]}]` del complemento
  `Pagos` 2.0) y textos de error para clientes ("pide a quien factura en CONTALINK…", no "al proveedor").
- **Servidor (etapa 1):** el prototipo corre `Code.js` en Node con un puente para los servicios de Google; C usa `Utilities.unzip`
  y N usa un activador semanal. Que cada uno quede detrás de una función interna pequeña (`descomprimir_(blob)`), para que el
  puente solo tenga que darla.

## 1. Lo que cada módulo publica para el margen y los reportes (funciones puras, sin servicios de Google)

El **integrador** (no los módulos) conecta esto con `margenDeContrato_` (tarjeta de margen de cobranza), el margen del resumen de
cobranza y `reporteMargen` (`margenPorProyecto` ya acepta `costosExtra[folio] = [{concepto, moneda, monto}]`).

```js
// G: costo de gastos por proyecto, SIN IVA, solo Aprobado y Reembolsado (no Enviado, Rechazado ni Anulado), en la moneda del
// gasto convertida a la del proyecto si el gasto trae tipo de cambio; si no se puede convertir, va en su moneda (el margen lo marca
// "Revisar" y no lo suma: nunca se mezclan monedas).
costoGastosPorProyecto(gastos, monedaDeProyecto) → { [proyectoFolio]: [{ concepto: 'Gastos', moneda, monto }] }

// N: costo de nómina repartido. Para cada persona y mes: costo_mensual × (horas aprobadas en el proyecto ese mes / horas aprobadas
// de esa persona ese mes en todos los proyectos). Mes sin costo capturado = horas sin costear (se cuentan aparte, no se inventan).
// Siempre en MXN.
costoNominaPorProyecto(horas, costos) → { [proyectoFolio]: [{ concepto: 'Nómina', moneda: 'MXN', monto, horas, sinCostear }] }

// A: lo contratado de más por adicionales aceptados (subtotal sin IVA y total con IVA, en la moneda del proyecto).
adicionalesPorProyecto(adicionales) → { [proyectoFolio]: { subtotal, total, moneda, n } }

// C: facturas vigentes por etapa (incluye las de etapas de adicionales).
facturasPorEtapa(facturas) → { [proyectoFolio]: { [claveEtapa]: [{ uuid, serieFolio, fecha, metodo, total, moneda, repPendiente }] } }
```

## 2. Reglas por módulo

### G · Gastos (decisiones 8 y 11)
- **Quién:** captura cualquiera con Requisiciones (también `@helgen.services`), **solo los suyos**; aprueba **Aprobaciones** (nunca lo
  suyo; super admin con motivo, como en el incremento 4); reembolsa **Compras** (con comprobante del reembolso); ven todos los gastos
  Aprobaciones, Compras y super admin.
- **Datos:** pestaña `Gastos` en el **libro de compras** (privado); archivos en `Compras/AAAA/<proyecto>/Gastos/` con `privado_`.
  Folio `GAS-AAAA-NNNN` (`CONSECUTIVO_GAS_AAAA`, bajo el candado).
- **Captura:** proyecto (Activo o Cerrado), fecha (no futura), categoría (`Viáticos · Combustible · Hospedaje · Casetas ·
  Herramientas · Otros`), concepto, monto, moneda (MXN/USD; tipo de cambio si no es la del proyecto), IVA incluido o no, **foto o
  PDF del ticket obligatorio**, XML del CFDI opcional (con `leerCfdi`: llena monto, IVA, RFC y UUID; UUID repetido se rechaza;
  el receptor debe ser el RFC de Helgen). Pensado para teléfono.
- **Estados:** Enviado → Aprobado | Rechazado (motivo) → Reembolsado; Enviado → Cancelado (quien lo capturó, motivo). Anular
  (módulo E) los acepta como un registro más.
- Correos sin montos (regla 17): `gasto.enviado` a Aprobaciones, `gasto.aprobado`/`gasto.rechazado` a quien lo capturó,
  `gasto.reembolsar` a Compras. Pendientes: por aprobar, por reembolsar.

### N · Horas y nómina (decisiones 9 y 10)
- **Rol nuevo `nomina`** (en `ROLES_CAPRI`, `NOMBRES_ROLES` y la página de Permisos; no delegable). Solo Nómina y super admin ven
  costos de personas; nadie más ve un costo individual, nunca (tampoco en correos, sincronizar, bootstrap ni CSV).
- **Líder de proyecto:** columna `lider_email` en `Proyectos` (se crea sola, por nombre); la asigna super admin o cobranza en la
  vista del proyecto. Aprueba las horas de su proyecto; las horas **del propio líder** las aprueba Aprobaciones.
- **Datos:** área privada nueva **NÓMINA** (como cobranza y compras: `AREA_NOMINA`, propiedades `NOMINA_FOLDER_ID` y `NOMINA_DB_ID`,
  todo con `privado_`) con el libro "CAPRI — Nómina y horas": `Horas` (semana ISO lunes, correo, proyecto, día, horas en pasos de
  0.25, actividad, estado Borrador/Enviada/Aprobada/Devuelta, quién aprobó, cuándo), `CostosPersonal` (correo, mes `AAAA-MM`,
  costo mensual MXN = sueldo + carga patronal, notas, quién capturó) y `Bitacora`.
- **Hoja de horas:** cualquier usuario activo (Google o `@helgen.services`) captura su semana (≤ 24 h por día, ≤ 7 días, proyectos
  Activo/Cerrado) y la envía; el líder aprueba o devuelve con motivo. Recordatorio por correo los viernes (activador de 15 min:
  una vez por semana, sin montos). Pantalla para teléfono: menos de un minuto.
- **Costo:** Nómina captura el costo mensual por persona (o lo sube en CSV: correo, mes, costo). El reparto es
  `costoNominaPorProyecto` (§1). Horas aprobadas sin costo del mes = "sin costear" (se ven en el reporte de Nómina, no en el margen).

### A · Adicionales (spec 4; CLAUDE.md §6.10)
- **Cotizar:** en un proyecto con contrato firmado se puede guardar una cotización **solo marcada "Adicional"** (columna `tipo` en
  `Cotizaciones`, se crea sola); misma moneda que el proyecto; el resto de reglas de `guardarCotizacion` igual (folio HLG, PDF).
  La regla "contrato firmado no admite cotizaciones nuevas" sigue para las normales.
- **Aceptar:** cobranza marca la adicional como aceptada → pestaña `Adicionales` del libro de cobranza (proyecto, cotización,
  subtotal, iva, total, moneda, estado Aceptada/Cancelada/Anulada, fecha, por) y su **mini-esquema** (por omisión 100 % en una etapa;
  editable por cobranza antes de su primer pago) en `Esquemas` con la columna nueva `adicional` = folio de la cotización (las etapas
  del contrato original la dejan vacía y **no cambian**).
- **Cobro:** los pagos de cobranza pueden aplicarse a etapas de adicionales (`repartirPago` con todas las etapas: contrato y
  adicionales); saldo del proyecto = contrato + adicionales − pagado. Vista y resumen de cobranza muestran "Contratado" y
  "Adicionales" en renglones aparte y el total. La fecha esperada (incremento 6) también aplica a sus etapas.
- Cancelar una adicional aceptada: cobranza con motivo, solo sin pagos aplicados; Anular la arrastra.

### C · Facturas de clientes, CFDI fase A
- **Importar:** cobranza sube uno o varios XML, o un **ZIP** (como lo descarga CONTALINK; `Utilities.unzip`), con su PDF opcional.
  `leerCfdi` (el de facturas de proveedor) los lee. Reglas: emisor = RFC de Helgen (Config `EMPRESA_RFC`); tipo **I** (ingreso),
  **E** (nota de crédito) o **P** (complemento de pago / REP); UUID repetido = se informa y no se duplica; un XML que no es de Helgen
  o no es CFDI 4.0 se rechaza con el motivo, sin detener a los demás del lote (resumen por archivo).
- **Ligar:** cada ingreso se liga a un proyecto (sugerido por el RFC del cliente y el monto) y a una o varias etapas (contrato o
  adicional); una E resta de lo facturado de su relacionada; una P marca qué facturas PPD ya tienen su REP.
- **Datos:** pestaña `FacturasClientes` del libro de cobranza (uuid, tipo, serie_folio, fecha, metodo PUE/PPD, forma, moneda,
  subtotal, iva, total, receptor RFC y nombre, proyecto, etapas (JSON), relacionadas (JSON), estado Vigente/Cancelada, xml y pdf
  id/url, registro) y archivos en `Cobranza/AAAA/<proyecto>/Facturas/` con `privado_`.
- **Pantalla:** en la vista de cobranza del proyecto, "Facturas" por etapa (facturado vs cobrado) y **"REP pendiente"** en las PPD con
  pagos sin complemento; en Pendientes de cobranza, las REP pendientes y los XML sin ligar. Marcar Cancelada a mano (motivo) cuando
  se cancele en CONTALINK.
- **Permisos:** solo cobranza y super admin. Nada de esto sale a ventas, compras ni a quien pide.

## 3. Para los cuatro
- Español de México; regla 18 (`escribe_`, `candado_`); `cambios` declarados; idempotencia de las escrituras con archivo en la hoja
  (no solo en el caché: lección del incremento 6); nada de HTTP ni correos dentro del candado; MXN y USD nunca se suman.
- Si una función nueva cambia la forma de algo que va en caché, el integrador cambia `VERSION_CODIGO_CACHE` (no los módulos).
- Pruebas en `tests/` con el arnés (`tests/arnes.js`; límite de 100 KB del caché incluido); `bash tests/todas.sh` en verde antes de
  cada commit. Cada módulo deja `docs/incremento-7-<modulo>.md` con lo que cambió, decisiones propias y notas de publicación
  (pestañas y columnas que se crean solas; permisos nuevos de Google si los hay: `Utilities.unzip` no pide ninguno).

## 4. Integración (hecha el 29/10/2026, rama `incremento-7`)
- Los cuatro módulos se unieron en este orden: A, G, N, C (choques de listas compartidas resueltos uniendo los dos lados; las secciones
  §6.A, §6.G, §6.N y §6.C quedan una tras otra al final de `Code.js`, y sus módulos de interfaz al final de `index.html`).
- **Margen (§6.I):** `margenCompleto(contrato, moneda, costos, adicional)` = contrato + adicionales − órdenes − gastos − nómina; gastos
  o nómina en otra moneda van en `sinSumar` ("Revisar"). Lo usan la tarjeta de cobranza, el resumen y Reportes → margen, con la misma
  cifra (`tests/integracion7.test.js`). La nómina del margen es de super admin y Nómina; cobranza solo la ve (el monto, sin horas) con
  `NOMINA_EN_MARGEN = cobranza` (§5 abajo; antes era al revés: `= superadmin` la ocultaba).
- **A + C:** `cobranzaParaFacturas` separa las etapas de las adicionales (antes las leía como del contrato) y las agrega con su clave
  `'<HLG>/<orden>'`, la misma que la vista del proyecto.
- **Sincronización y cachés:** la vista del proyecto de cobranza se vuelve a mandar al cambiar `facturasClientes`, `adicionales`,
  `gastos` y, a quien ve la nómina, `horas` o `costosPersonal` (`coleccionesMargen7_()`); el resumen y el reporte de margen usan esas
  versiones en su caché. `VERSION_CODIGO_CACHE = 2026-10-29s`.
- Arreglo del incremento 6 (hallazgo de G): la huella del pago parcial se escribe con `textoCelda`.

## 5. Revisión independiente: permisos, privacidad y entrada de datos (29/10/2026, rama `incremento-7-fix-privacidad`)
Reproducciones de los revisores convertidas en `tests/revision7-privacidad.test.js` (fallan con `6b7f14f`, pasan con el arreglo).
- **Nómina en el margen = oráculo del costo de una persona.** Con la nómina por proyecto en el margen de cobranza: (A) cobranza se
  nombraba líder, aprobaba la semana de alguien y el margen bajaba exactamente su costo mensual; (B) con el resumen abierto, cada
  `guardarCostoPersonal` subía `costosPersonal`, `sincronizar` le mandaba el resumen nuevo y la diferencia era el costo; (C) devolver una
  semana aprobada de hace meses (sin huella ni límite) lo descubría para meses pasados. Arreglo (decidido): `nominaEnMargen_()` = super
  admin o Nómina; cobranza solo si `NOMINA_EN_MARGEN` es exactamente `cobranza` (falla cerrada) y entonces sin `horas` ni `sinCostear`;
  `nominaOculta: true` en tarjeta, resumen y reporte (la interfaz lo dice); `coleccionesMargen7_()`; la versión de `costosPersonal` se
  enmascara (`versionesVisibles_`, bootstrap y sincronizar, también para comparar: sin vueltas); `asignarLider` rechaza nombrarse a sí
  mismo (salvo super admin); devolver una parte **Aprobada** exige `huella` y solo semanas de la ventana de «Por aprobar»
  (`SEMANAS_REVISADAS_HORAS`; antes, super admin).
- **Gastos (G):** `guardarGasto`/`reembolsarGasto` sin HTTP con el candado (regla 17: archivos con `archivoPrivado_` antes, `setName`
  con el folio adentro); si `privado_` o lo de adentro falla, o el envío resulta repetido, los archivos van a la Papelera; Compras no
  registra el reembolso de su propio gasto (otra persona de Compras o super admin con `motivoExcepcion`); UUID repetido: a quien captura
  un texto general, el folio solo a Compras y super admin.
- **Entrada de datos:** XSS por el XML de un gasto (`verArchivo` lo abría como `application/xml` en el origen de CAPRI): el servidor lo
  manda como `text/plain` y la interfaz (`abrirArchivoServidor`, también para `verArchivoReq`) solo abre PDF/JPG/PNG con el tipo de su
  lista blanca y bytes comprobados; el XML se enseña como texto en un `<pre>`, lo demás se descarga. `leerCfdi` agrega `locales`
  (`{trasladados, retenidos}`; lo demás no cambia): en un gasto el ISH es costo y el IVA solo el federal. Un CFDI de Helgen a Helgen no
  entra como gasto (el lado de facturas de clientes lo arregla otra rama).
