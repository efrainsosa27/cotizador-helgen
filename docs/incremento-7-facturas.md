# Incremento 7 (CAPRI) · Módulo C: facturas de clientes (CFDI fase A)

Rama `incremento-7-facturas` (sobre `incremento-7-base` = `incremento-6-final` + `docs/incremento-7.md`). Contrato:
`docs/incremento-7.md` §0, §1 (`facturasPorEtapa`), §2 "C" y §3. Spec aprobado por Leo: "CAPRI — what's missing: spec for increments
6–8" (decisiones 6–11). **Helgen timbra en CONTALINK** (su PAC); CAPRI **no timbra ni cancela ante el SAT**: importa los XML que CONTALINK
genera y los liga a las etapas de cobranza. Este archivo es para integrar: al hacer el merge se pasa lo necesario a `CLAUDE.md` (§1, §4.5.2,
§4.6, §4.7, §4.8 o §4.11, §5 libro de cobranza, §6.11, §9) y al Manual (Cobranza, un apartado "Facturas de clientes", Pendientes,
Historial, Reglas de oro).

## 0. Decisiones que el contrato no fijaba (revísalas primero)

1. **Clave de etapa** (`claveEtapa(e, i)`): `'1'`, `'2'`, `'3'`… = **orden** de la etapa en el esquema del contrato (el mismo número que
   `Pagos.etapa_orden` y `guardarFechasEsperadas`); `'<folio HLG de la adicional>/<orden>'` (p. ej. `HLG-2026-0012/1`) = etapa de una
   adicional (módulo A). Las etapas salen siempre de `resumenCobranza` (la vista: `vistaCobranza_`; la lista: `cobranzaParaFacturas`), así
   que en cuanto A agregue sus etapas al resumen con `{adicional, orden}` las facturas ya las ven. **Punto de integración con A**: si las
   etapas de las adicionales no quedan dentro de `resumenCobranza`, hay que pasarlas también a `cobranzaParaFacturas` (comentario
   "PUNTO DE INTEGRACIÓN CON A" en `contextoFacturasCli_`). Si alguien renombra o quita etapas (antes de firmar, o tras un desbloqueo),
   la factura queda **"Por revisar"** ("una etapa de la liga ya no existe") y se vuelve a ligar; nunca se reasigna sola.
   **Revisión del incremento 7 (dinero):** la liga guarda la clave **y el nombre** de cada etapa (`etapas (JSON)`: `{clave, etapa,
   monto}`); si en esa clave ahora hay una etapa con otro nombre (sin acentos ni mayúsculas), la factura queda "Por revisar" ("La etapa
   «X» de la liga ya no está… en su lugar ahora está «Y»"), **no cuenta** en esa etapa y sale en Pendientes (antes se pasaba sola a la
   etapa que heredaba el número). Una liga sin nombre (de antes) solo se revisa por la clave. Además **no se puede** cambiar un esquema
   que renumere, renombre o quite una etapa con facturas I o E Vigentes ligadas (`facturasQueImpidenCambiarEsquema`,
   `exigirEsquemaSinFacturasLigadas_`): `guardarEsquema` (antes de firmar o tras un desbloqueo), `guardarEsquemaAdicional`,
   `cancelarAdicional` y `marcarAceptada` cuando pasa a Helgen Energy y reemplaza el esquema. El error lista las facturas ("A-201 (etapa 1
   «Pago único» → «Anticipo»)") y dice qué hacer: volver a ligarlas o marcarlas Canceladas. Agregar etapas al final y cambiar porcentajes
   sí se puede (si una etapa queda con menos monto que lo facturado, su "por facturar" sale negativo y se ve). Una liga que ya estaba por
   revisar no detiene el cambio. Anular (super admin) no se detiene: lo que deja sin etapa queda "Por revisar".
2. **Dónde viven los archivos** (`carpeta_proyecto` dice dónde están):
   - ligada: `Cobranza/<año del folio del proyecto>/<PRY-AAAA-NNNN>/Facturas/` (el mismo año que usan los comprobantes de pago);
   - sin ligar: `Cobranza/<año de la fecha del CFDI>/Sin proyecto/Facturas/`;
   - al **ligar** una factura se mueven sus XML y PDF (`moveTo`, ya privados) y también los de sus notas de crédito y los REP que
     ya solo tocan ese proyecto; un REP que paga facturas de **dos proyectos** se queda donde está. Una E o una P cuya factura ya está
     ligada se guarda directo en la carpeta de ese proyecto al importarla. "Marcar sin proyecto" **no mueve** archivos.
   - Todo con `privado_` de arriba abajo (año → proyecto/Sin proyecto → Facturas → cada archivo). Si `privado_` falla con un archivo
     recién creado, ese archivo se manda a la Papelera antes de lanzar el error (nada queda abierto al dominio).
3. **"Sin proyecto"** (no pedido en el contrato, pero necesario): el ZIP de CONTALINK trae **todas** las facturas del periodo, también
   ventas que no se llevan en CAPRI (p. ej. público en general). Sin esta salida se quedarían para siempre en "XML sin ligar". Se marca con
   motivo (≥ 5 caracteres, Bitácora) desde el mismo formulario de liga; después se puede ligar a un proyecto.
4. **Nota de crédito (E):** resta de sus relacionadas que estén en CAPRI, Vigentes y en su misma moneda (cualquier `TipoRelacion` salvo
   `04`), en el orden del XML y hasta lo que le queda a cada una; dentro de una factura repartida en varias etapas, **en proporción**. Si
   su factura no está en CAPRI (p. ej. de antes), la E queda "sin ligar" y cobranza la liga a mano a etapas: entonces resta de esas etapas
   y se mide contra **lo ya facturado** (no contra lo que falta). Una E mayor que lo que queda de sus facturas queda "Por revisar".
   Revisión del incremento 7 (dinero): una E **sustituida** (otra E Vigente la sustituye con `04`) ya no resta.
5. **Sustitución (`TipoRelacion 04`):** la factura nueva dice a cuál sustituye; la sustituida queda "Por revisar: márcala Cancelada
   cuando la canceles en CONTALINK". CAPRI no cancela nada sola. Revisión del incremento 7 (dinero): con un **REP (P)** o una **nota de
   crédito (E)** sustituida, la de antes **ya no cuenta** (ni como REP ni como lo que resta; antes un REP corregido de 400 y el de 1,000
   que sustituía sumaban 1,400 y tapaban un REP pendiente de 600) y **el par** queda "Por revisar" mientras la de antes siga Vigente en
   CAPRI ("Lo sustituye el REP P-2…" / "Sustituye al REP P-1…, que sigue Vigente"); al marcarla Cancelada se quita. Una factura I
   sustituida sigue como antes (cuenta y queda por revisar).
6. **Cobrado por factura:** lo cobrado de cada etapa (de `resumenCobranza`, el mismo reparto de la vista) se reparte entre las facturas
   de esa etapa **de la más vieja a la más nueva** (fecha, serie-folio, UUID), hasta lo facturado de cada una.
7. **REP pendiente** (`calcularFacturasClientes`, puro): factura **PPD**, ligada, con **cobrado − lo cubierto por sus REP > 1.00**
   (`TOLERANCIA_PAGO`, en la moneda del proyecto). Lo cubierto = suma de `ImpPagado` de los `DoctoRelacionado` de los complementos P
   Vigentes con su UUID (solo en la moneda de la factura). Lo contrario (REP por más de lo cobrado en CAPRI) se marca **"¿falta registrar un
   pago?"** (`repSinCobro`), sin pendiente. Una PUE nunca pide REP. En Pendientes, el REP pendiente cuenta desde el **último pago** del
   proyecto y es urgente a los 30 días. Revisión del incremento 7 (dinero): si el **último REP** de la factura (por fecha y parcialidad)
   deja `ImpSaldoInsoluto` ≤ 1.00, la factura ya tiene sus REP aunque lo cobrado y lo del REP difieran (factura en USD cobrada en MXN:
   CAPRI y el REP convierten con tipos de cambio distintos); y "¿falta registrar un pago?" no sale si CAPRI ya la tiene cobrada completa.
8. **Reparto al ligar** (`armarLigaFactura`): sin montos, el total va en el orden del esquema hasta lo que falta facturar de cada etapa
   elegida y la última se queda con el resto; con montos, deben sumar el total y cada etapa no puede pasar lo que le falta (+1.00). En
   ambos casos lo neto de la factura (sin sus notas de crédito) no puede pasar lo que falta facturar de las etapas elegidas (+1.00):
   "elige también la etapa siguiente". Solo proyectos no Cancelados, con cotización **aceptada o contrato firmado**, en la misma moneda.
   Volver a ligar cambia la liga (Bitácora con "antes").
9. **`facturasPorEtapa(facturas, cobranza?)`**: la forma de salida es **exactamente** la del contrato. Acepta un segundo parámetro
   opcional (`cobranzaParaFacturas`) porque `repPendiente` necesita lo cobrado; sin él usa `f.repPendiente` de cada factura (o `false`).
   `total` = la parte de esa etapa ya sin sus notas de crédito; una E ligada a mano sale con total **negativo**. Para el integrador:
   `facturasPorEtapa(facturasClientesDelLibro_(libro), contextoFacturasCli_().cobranza)`.
10. **Idempotencia en la hoja:** el UUID es la llave natural (un envío repetido nunca duplica). `id_solicitud` guarda el envío: si el
    mismo envío se reintenta, el resultado dice "importada" (no "repetida"). Dentro del candado se vuelve a revisar el UUID (otro envío
    pudo importarlo al mismo tiempo): si ya está, los archivos que se crearon de más van a la Papelera.
11. **Columnas extra** (después de las del contrato, en este orden): `pagos (JSON)` (P), `descuento`, `retenidos`, `fecha_timbrado`,
    `uso_cfdi`, `archivo_xml` (nombre original, para emparejar un PDF que llega después), `carpeta_proyecto`, `ligo_email`,
    `fecha_ligado`, `cancelado_por`, `fecha_cancelacion`, `motivo_cancelacion`, `id_solicitud`, `sin_proyecto`. `iva` = impuestos
    trasladados del CFDI. `tipo` = la letra del SAT (I, E, P). En una E o una P, `proyecto_folio` es informativo (el de su factura) salvo
    una E ligada a mano (con `etapas`).
12. **Lo que queda en "Por atender"** (y en Pendientes de cobranza): XML sin ligar (I, o E sin su factura en CAPRI, sin "sin proyecto"),
    REP pendiente y facturas por revisar (etapa que ya no existe, moneda distinta del proyecto, proyecto sin aceptada o anulado, E de más,
    sustituida). Un complemento P nunca está "sin ligar": sus documentos que no están en CAPRI solo se señalan en la lista.

## 1. Cómo se exporta de CONTALINK (genérico)

**No conocemos los menús exactos de CONTALINK** (no hay acceso desde aquí): estas instrucciones son genéricas y conviene que quien
factura las ajuste con los nombres reales la primera vez.

1. En CONTALINK, abre la lista de **comprobantes emitidos** (facturas, notas de crédito y complementos de pago / REP) y filtra por el
   periodo (p. ej. el mes).
2. Elige los comprobantes y **descarga el XML** (y si quieres el PDF). Si CONTALINK entrega un **ZIP**, súbelo tal cual: CAPRI lo abre,
   recorre sus carpetas e ignora lo que no sea XML o PDF (y la basura de macOS).
3. En CAPRI: **Cobranza → 3 · Facturas de clientes → Importar**. Puedes subir varios XML con sus PDF (mismo nombre de archivo, o el UUID
   en el nombre del PDF) o el ZIP. Máximo 20 MB por envío; la interfaz manda cada ZIP en su propio envío y junta los sueltos.
4. Revisa el resultado por archivo (Importada · PDF · Ya estaba · Rechazada con el motivo · Pendiente · Ignorada) y liga cada factura
   nueva a su proyecto y etapas (la sugerencia sale por el RFC del cliente y el monto).
5. Cuando se cancele algo en CONTALINK, márcalo **Cancelada** en CAPRI (×, con motivo).

Rechazos típicos: XML emitido por otra empresa (factura de proveedor: va en Compras), CFDI 3.3, tipo T o N, moneda distinta de MXN/USD,
XML sin timbre o que no cuadra ("pide a quien factura en CONTALINK el XML correcto").

## 2. Qué cambió

### Servidor (`Code.js`, sección 6.C de facturas de clientes, al final del archivo)
- **Módulo** `modFacturasClientes_()` (en `MODULOS_`): `api` = `importarFacturasClientes`, `listarFacturasClientes`,
  `ligarFacturaCliente`, `cancelarFacturaCliente`; `cambios` = las tres que escriben → `['facturasClientes']`; `bootstrap` (solo con
  cobranza: `facturasCli` si ya está en caché); `sincronizar` (con cobranza: la lista si el navegador la tiene —`ctx.facturasCli`— y
  cambió algo de lo que usa; la vista del proyecto abierto si solo cambiaron facturas; los pendientes si cambiaron facturas, pagos de
  cobranza o contratos); `preparar` (crea la pestaña si el libro de cobranza ya existe).
- **API (todas con `exigirCobranza_`; el super admin tiene el rol):**
  - `importarFacturasClientes({archivos: [{nombre, datos}], idSolicitud})` → `{resultados (uno por archivo), conteos, lista}`. Límites:
    60 archivos y 20 MB por envío; XML ≤ 2 MB (`validarXml`); PDF ≤ 10 MB (`validarArchivo`); ZIP ≤ 400 archivos y ≤ 60 MB
    descomprimido; ZIP dentro de ZIP rechazado; 100 facturas nuevas por envío (las demás "Pendiente": volver a subir); a los 4 min ya no
    se crean archivos (lo que falta queda "Pendiente"). Orden: I, luego E, luego P.
  - `listarFacturasClientes()` → `vistaFacturasClientes` (en caché `FACCLI` por versión de `facturasClientes`, `proyectos`,
    `contratos`, `pagosCobranza`, `anulaciones`).
  - `ligarFacturaCliente({uuid, proyectoFolio, etapas: [{clave, monto?}], sinProyecto, desde})` → `{uuid, lista, vista?}`.
  - `cancelarFacturaCliente(uuid, motivo, desde)` → `{uuid, lista, vista?}` (Vigente → Cancelada; no se borra ni mueve nada).
- **Internas:** `descomprimir_(blob)` (único uso de `Utilities.unzip`; devuelve `[{nombre, bytes}]`: el servidor de la etapa 1 solo tiene
  que dar esta función), `carpetaFacturasCli_`, `archivoPrivado_`, `papeleraFacturas_`, `entradasDeZip_`, `contextoFacturasCli_`,
  `facturasClientesDelLibro_`, `facturaCliDesdeFila_`, `facturasDeVistaCobranza_`, `facturasCliParaPendientes_`, `colFacCli_`, `jsonDeCelda_`.
- **Lógica pura (se prueba en Node):** `leerCfdiCliente` (= `leerCfdi` sin cambios —desde la revisión del 29/10/2026 trae también `locales`— + `relacionados` + `pagos` de Pagos 2.0; sin DTD
  ni entidades, solo atributos; errores "pide a quien factura en CONTALINK…" con `textoErrorCfdiCliente`), `validarFacturaCliente`,
  `tipoArchivoFactura`, `nombreBaseArchivo`, `nombreArchivoFacturaCliente`, `prepararLoteFacturasCliente`, `resultadoRepetida`,
  `mensajeImportada`, `totalPagosRep`, `proyectoInicialFactura`, `filaFacturaCliente`, `claveEtapa`, `etapasParaFacturas`,
  `cobranzaParaFacturas`, **`calcularFacturasClientes`** (E, cobrado, REP, REP pendiente), **`facturasPorEtapa`** (contrato §1),
  `normalizarEtapasElegidas`, `armarLigaFactura`, `nombreFiscalNormal`, `sugerirLigaFactura`, `vistaFacturasClientes`,
  `bloqueFacturasDeProyecto`, `itemsFacturasCliPendientes`.
- **No se tocó** nada de facturas de proveedor (`leerCfdi`, `validarFacturaProveedor`, `FacturasProveedor`, Cuentas por pagar).

### Interfaz (`web/cotizador/index.html`, `<script id="mod-facturas">`, `window.FACTURAS_CLI`)
- **Cobranza → resumen → "3 · Facturas de clientes (CFDI)"** (`#cobModFacturas`, tercer módulo de la vista; máximo 3): importar
  (selector múltiple de XML/PDF/ZIP; cada ZIP en su envío; XML y PDF del mismo nombre siempre juntos), resultado del último envío por
  archivo, mosaicos (XML sin ligar, REP pendientes, Por revisar, Importadas), "Por atender" / "Todas", búsqueda y tipo, tabla con
  proyecto y etapas, estado (REP pendiente, REP al día, cobrado, notas de crédito, "¿falta registrar un pago?"), ligas a XML y PDF,
  **Ligar / Cambiar** (sugerencias, proyecto de la misma moneda, etapas con facturado y por facturar, montos opcionales con vista
  previa del reparto, "Marcar sin proyecto" con motivo) y **×** (marcar Cancelada con motivo, `window.prompt`).
- **Vista del proyecto → esquema → "Facturas por etapa (CONTALINK)"** (`#cobFacturas`): facturado, cobrado, por facturar y REP
  pendientes; por etapa sus facturas (método, parte de la etapa, REP pendiente/REP, PDF y XML); "por revisar"; "Hay N facturas de este
  cliente sin ligar".
- **Pendientes:** sección **Cobranza** (REP pendiente, XML sin ligar, factura por revisar); el botón abre Cobranza → la factura (con su
  liga abierta si está sin ligar). Liga del pendiente: `destino 'fac'`, `req` = UUID.

## 3. Puntos compartidos (cambios mínimos; el integrador une los choques)

| Dónde | Cambio |
|---|---|
| `Code.js` `MODULOS_` | `+ modFacturasClientes_()` |
| `Code.js` `COLECCIONES` | `+ 'facturasClientes'` al final |
| `Code.js` `HOJAS_COBRANZA` | `+ FacturasClientes` (37 columnas; importes 8, 9, 10, 25, 26) |
| `Code.js` `vistaCobranza_` | `+ facturas: facturasDeVistaCobranza_(libro, proyecto, c, resumen)` (A también cambia esta función: mi campo recibe su `resumen`) |
| `Code.js` `pendientes()` | `roles.cobranza` y `o.facturasCli` (solo con cobranza) |
| `Code.js` `itemsPendientes` | una línea antes de ordenar: `itemsFacturasCliPendientes(x.facturasCli, …)` con `roles.cobranza || todos` |
| `index.html` | `<div id="cobModFacturas" class="modulo oculto">` al final de `#cobVistaResumen`; `<div id="cobFacturas" class="oculto">` en `#cobModEsquema` después de `#cobFechas` |
| `index.html` `mod-pantallas` | `SECCIONES_PEND` + `['cobranza', 'Cobranza', 'Cobranza']`; `abrirDestino`: `fac → cob` y `FACTURAS_CLI.abrir(uuid, tipo)` |
| `tests/cobranza.test.js`, `compras.test.js`, `requisiciones.test.js` | las pestañas del libro de cobranza ahora incluyen `FacturasClientes` (el libro nuevo se crea con todas); la lista de versiones incluye `facturasClientes` |

`conteosPendientes` no cambió (la sección cobranza cuenta en el total; la pestaña Cobranza no lleva número). Nada en
`PREFIJOS_ANULAR` (contrato: las facturas de clientes se marcan Cancelada); lo anulado se respeta: pagos y contratos anulados no
cuentan, y una factura ligada a un proyecto anulado queda "Por revisar".

## 4. Rapidez y caché
- La vista de cobranza del proyecto lee **una pestaña más** (`FacturasClientes`, una vez por petición con `filasEnPeticion_`); sin
  facturas importadas solo cuesta su `getLastRow` y el campo sale `null`.
- Pendientes de cobranza usa la lista en caché (`FACCLI`); con el caché frío arma la lista (lee Contratos, Esquemas, Pagos y
  FacturasClientes). `bootstrap` manda la lista solo si ya está en caché (Pendientes la deja calculada en la misma carga).
- Escrituras: `escribe_` y `conCandado_` (regla 18); una sola escritura para todas las filas nuevas de un envío. Ninguna llamada HTTP
  dentro del candado (comprobado con el perfil del arnés): `privado_` y las carpetas van antes; dentro solo Sheets y `moveTo` de Drive.
- `VERSION_CODIGO_CACHE` **no se cambió** (regla del contrato). Las claves nuevas (`FACCLI`) no chocan con nada; la vista de cobranza
  no se guarda en caché. Cambiarlo o no lo decide el integrador.
- La lista va completa a la interfaz (todas las facturas, ~600 bytes cada una): en caché hasta ~1,400 facturas (30 trozos); con más
  se arma de la hoja en cada consulta. Si algún día pesa, limitar a las de los últimos 12 meses más las abiertas.

## 5. Pruebas
`tests/facturas-clientes.test.js` (en `bash tests/todas.sh`):
0. **Revisión del incremento 7 (dinero):** `tests/revision7-dinero.test.js` §1 (liga por número y nombre, esquemas que la moverían), §6
   (REP con saldo insoluto en cero) y §8 (REP y nota de crédito sustituidos); sondas de la revisión en `tests/revision7/`.
1. **Pura:** fixtures de CFDI 4.0 como los de CONTALINK (I PUE, I PPD, E relacionada 01, P Pagos 2.0 con 2 pagos sobre 2 facturas,
   sustitución 04, factura de proveedor, CFDI 3.3, T, N, EUR), `leerCfdi` sin cambios, DTD, Pagos 1.0, textos para clientes, lote (PDF por
   nombre y por UUID, repetidas, orden, límite de 100), cálculo (E proporcional, cobrado de la más vieja a la más nueva, REP, REP
   pendiente, REP sin cobro, etapa que ya no existe, moneda, proyecto sin aceptada, E a mano, E de más), `facturasPorEtapa` (forma
   exacta), `armarLigaFactura`, sugerencias, `claveEtapa` con adicionales, pendientes.
2. **Servidor:** un **ZIP de verdad** (deflate, con carpetas, `__MACOSX`, `.DS_Store`, ZIP dentro de ZIP, `.txt`; `Utilities.unzip`
   simulado que lee el directorio central) junto con XML y PDF sueltos; rechazos sin detener a los demás; repetidas (otro envío, mismo
   envío, dos veces en el mismo); PDF que llega después; archivos privados y movidos al ligar; sugerencias; ligar (auto, montos, cada
   error), cambiar liga, sin proyecto, E a mano; REP pendiente con pagos reales de cobranza y REP que lo cubre; vista del proyecto;
   Pendientes; cancelar; sincronizar; **carrera** de dos envíos (UUID guardado mientras se creaban archivos → no se duplica y sus
   archivos van a la Papelera); **tiempo** (lo que no alcanza queda "Pendiente"); límites (60 archivos, 20 MB, 400 en el ZIP, ZIP roto
   o vacío); **permisos y fugas** (cada función de la API para ventas, compras, requisición y solo requisición; `bootstrap`,
   `sincronizar` y `pendientes` sin UUID, folios, nombres ni errores de facturas); **perfil**: ninguna llamada HTTP con el candado
   tomado al importar ni al ligar.
3. **Interfaz:** subir un ZIP y un XML (dos envíos), resultados, ligar con la sugerencia, buscar, cancelar sin motivo, facturas por
   etapa en la vista del proyecto, Pendientes → la factura con su liga abierta, "sin proyecto"; ventas, compras y requisición sin nada.
También se probó que las pruebas fallan si se quita la revisión del emisor, la revisión dentro del candado, la regla de REP, la nota de
crédito, el filtro de rol de Pendientes, `bootstrap` y `sincronizar`, `exigirCobranza_` o el movimiento de archivos.

## 6. Publicar (con el resto del incremento 7)
- **Sin permisos nuevos de Google**: `Utilities.unzip` no pide ninguno; `moveTo` y `setTrashed` usan el permiso de Drive que ya
  tiene la API; `privado_` ya usa `UrlFetchApp`.
- La pestaña `FacturasClientes` se crea sola (al importar la primera vez, o con `prepararCapri()` si el libro de cobranza ya existe).
  Las carpetas `Cobranza/AAAA/Sin proyecto/Facturas` y `…/<proyecto>/Facturas` también, restringidas.
- Respaldar el libro de cobranza antes (como siempre; §2 de `CLAUDE.md`).
- Avisar a cobranza: dónde importar, que los REP pendientes salen en Pendientes y que una cancelación en CONTALINK se marca a mano.
- **Fase B** (timbrar desde CAPRI) sigue fuera: necesita PAC y CSD.
