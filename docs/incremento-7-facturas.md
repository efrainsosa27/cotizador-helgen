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
5. **Sustitución (`TipoRelacion 04`):** la factura nueva dice a cuál sustituye; la sustituida queda "Por revisar: márcala Cancelada
   cuando la canceles en CONTALINK". CAPRI no cancela nada sola.
6. **Cobrado por factura:** lo cobrado de cada etapa (de `resumenCobranza`, el mismo reparto de la vista) se reparte entre las facturas
   de esa etapa **de la más vieja a la más nueva** (fecha, serie-folio, UUID), hasta lo facturado de cada una.
7. **REP pendiente** (`calcularFacturasClientes`, puro): factura **PPD**, ligada, con **cobrado − lo cubierto por sus REP > 1.00**
   (`TOLERANCIA_PAGO`, en la moneda del proyecto). Lo cubierto = suma de `ImpPagado` de los `DoctoRelacionado` de los complementos P
   Vigentes con su UUID (solo en la moneda de la factura). Lo contrario (REP por más de lo cobrado en CAPRI) se marca **"¿falta registrar un
   pago?"** (`repSinCobro`), sin pendiente. Una PUE nunca pide REP. En Pendientes, el REP pendiente cuenta desde el **último pago** del
   proyecto y es urgente a los 30 días.
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

Rechazos típicos: XML emitido por otra empresa (factura de proveedor: va en Compras), CFDI de Helgen a la misma Helgen (receptor =
`EMPRESA_RFC`), CFDI 3.3, tipo T o N, moneda distinta de MXN/USD (en un complemento de pago: cada pago y cada documento que paga),
XML sin timbre, que no cuadra o con una referencia a un carácter que no existe ("El XML no es válido…"), y un REP o una nota de
crédito tan grande que no cabe en una celda (más de 45,000 caracteres: "pide que lo divida en varios CFDI"). Cada rechazo es solo de
ese archivo: los demás del envío se importan.

## 2. Qué cambió

### Servidor (`Code.js`, sección 6.C de facturas de clientes, al final del archivo)
- **Módulo** `modFacturasClientes_()` (en `MODULOS_`): `api` = `importarFacturasClientes`, `listarFacturasClientes`,
  `ligarFacturaCliente`, `cancelarFacturaCliente`; `cambios` = las tres que escriben → `['facturasClientes']`; `bootstrap` (solo con
  cobranza: `facturasCli` si ya está en caché); `sincronizar` (con cobranza: la lista si el navegador la tiene —`ctx.facturasCli`— y
  cambió algo de lo que usa; la vista del proyecto abierto si solo cambiaron facturas; los pendientes si cambiaron facturas, pagos de
  cobranza o contratos); `preparar` (crea la pestaña si el libro de cobranza ya existe).
- **API (todas con `exigirCobranza_`; el super admin tiene el rol):**
  - `importarFacturasClientes({archivos: [{nombre, datos}], idSolicitud})` → `{resultados (uno por archivo), conteos, lista}`. Límites:
    60 archivos y 20 MB por envío; XML ≤ 2 MB (`validarXml`); PDF ≤ 10 MB (`validarArchivo`); **por envío** (no por ZIP; revisión 7c,
    §7): ≤ 60 MB descomprimido contando los sueltos (`MAX_DESCOMPRIMIDO`), ≤ 400 archivos (`MAX_ENTRADAS_ZIP`) y ≤ 1,000 entradas de ZIP
    contando carpetas y basura (`MAX_ENTRADAS_ZIP_TODAS`), revisado con el índice del ZIP **antes** de inflarlo y otra vez con lo que
    salió; ZIP dentro de ZIP rechazado; ninguna celda de más de 45,000 caracteres (por archivo, antes de crear nada); 100 facturas
    nuevas por envío (las demás "Pendiente": volver a subir); a los 4 min ya no se crean archivos (lo que falta queda "Pendiente").
    Orden: I, luego E, luego P. Todo archivo de Drive creado en la llamada que no quedó en un renglón va a la Papelera (`finally`).
  - `listarFacturasClientes()` → `vistaFacturasClientes` (en caché `FACCLI` por versión de `facturasClientes`, `proyectos`,
    `contratos`, `pagosCobranza`, `anulaciones`).
  - `ligarFacturaCliente({uuid, proyectoFolio, etapas: [{clave, monto?}], sinProyecto, desde})` → `{uuid, lista, vista?}`.
  - `cancelarFacturaCliente(uuid, motivo, desde)` → `{uuid, lista, vista?}` (Vigente → Cancelada; no se borra ni mueve nada).
- **Internas:** `descomprimir_(blob, limite)` (único uso de `Utilities.unzip`; devuelve `[{nombre, bytes}]` y lanza `zipExcedido` si lo
  que sale pasa de `limite`: el servidor de la etapa 1 solo tiene que dar esta función, §6), `carpetaFacturasCli_`, `archivoPrivado_`,
  `papeleraFacturas_`, `entradasDeZip_(nombre, bytes, entradas, previos, presupuesto)`, `contextoFacturasCli_`,
  `facturasClientesDelLibro_`, `facturaCliDesdeFila_`, `facturasDeVistaCobranza_`, `facturasCliParaPendientes_`, `colFacCli_`, `jsonDeCelda_`.
- **Lógica pura (se prueba en Node):** `leerCfdiCliente` (= `leerCfdi` sin cambios + `relacionados` + `pagos` de Pagos 2.0; sin DTD
  ni entidades, solo atributos; errores "pide a quien factura en CONTALINK…" con `textoErrorCfdiCliente`), `validarFacturaCliente`,
  `tipoArchivoFactura`, `indiceZip` (directorio central del ZIP sin inflar), `esArchivoDeZip`, `recortarTexto`, `nombreBaseArchivo`,
  `nombreArchivoFacturaCliente`, `prepararLoteFacturasCliente`, `soltarBytesNoUsados`, `pdfComoSuXml`, `datosFacturaCliente` (las celdas
  que salen del CFDI, recortadas y con `textoCelda`), `resultadoRepetida`,
  `mensajeImportada`, `totalPagosRep`, `proyectoInicialFactura`, `filaFacturaCliente`, `claveEtapa`, `etapasParaFacturas`,
  `cobranzaParaFacturas`, **`calcularFacturasClientes`** (E, cobrado, REP, REP pendiente), **`facturasPorEtapa`** (contrato §1),
  `normalizarEtapasElegidas`, `armarLigaFactura`, `nombreFiscalNormal`, `sugerirLigaFactura`, `vistaFacturasClientes`,
  `bloqueFacturasDeProyecto`, `itemsFacturasCliPendientes`.
- **No se tocó** nada de facturas de proveedor (`leerCfdi`, `validarFacturaProveedor`, `FacturasProveedor`, Cuentas por pagar). La
  revisión 7c sí cambió `atributosXml`, que comparten: con XML válido da lo mismo de antes (§7).

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

`tests/revision7-importar.test.js` (revisión 7c, §7; en `bash tests/todas.sh`): un caso por hallazgo. Se probó que falla con cada uno de
estos 16 cambios por separado: sin índice antes de inflar, presupuesto por ZIP, sin medir después de inflar, sin soltar bytes, sin
revisar celdas por archivo, sin Papelera en el `finally`, nombre sin `textoCelda` o sin recortar, sin monedas del REP, sin
Helgen→Helgen, sin el error en español, decodificar en pasadas, sin UUID de relacionados, PDF de un XML fallido que dice "PDF", y en
la interfaz el error oculto o sin aviso con la lista. Las pruebas de concepto de la revisión están en `tests/revision7/` (copias que
ahora comprueban lo corregido; `bash tests/revision7/correr.sh`; `p9` necesita playwright con Chromium y deja sus capturas fuera del
repositorio).

## 6. Publicar (con el resto del incremento 7)
- **Sin permisos nuevos de Google**: `Utilities.unzip` no pide ninguno; `moveTo` y `setTrashed` usan el permiso de Drive que ya
  tiene la API; `privado_` ya usa `UrlFetchApp`.
- La pestaña `FacturasClientes` se crea sola (al importar la primera vez, o con `prepararCapri()` si el libro de cobranza ya existe).
  Las carpetas `Cobranza/AAAA/Sin proyecto/Facturas` y `…/<proyecto>/Facturas` también, restringidas.
- Respaldar el libro de cobranza antes (como siempre; §2 de `CLAUDE.md`).
- Avisar a cobranza: dónde importar, que los REP pendientes salen en Pendientes y que una cancelación en CONTALINK se marca a mano.
- **Fase B** (timbrar desde CAPRI) sigue fuera: necesita PAC y CSD.

### Puente de la etapa 1 (servidor en Node)
Lo que el puente tiene que dar para este módulo (y lo del incremento 7 que usa lo mismo), además de Sheets y `privado_` (UrlFetch a la API
de permisos de Drive):
- **`Utilities.unzip(blob)` con tope de salida**, detrás de `descomprimir_(blob, limite)`: devolver `[{nombre, bytes}]` (también las
  carpetas, con "/") y **cortar al inflar** cuando lo que sale pase de `limite` (p. ej. `zlib.inflateRawSync(datos, {maxOutputLength:
  lo que queda})`), lanzando un error con `zipExcedido = true`. En Apps Script no se puede: `Utilities.unzip` infla todo y solo después
  se mide; por eso antes se revisa el índice (`indiceZip`) y un ZIP que miente en él se infla una vez antes de rechazarse. El puente
  no debe heredar ese hueco.
- **`File.setTrashed(true)`** (`papeleraFacturas_` y `archivoPrivado_`: lo creado que no quedó en un renglón va a la Papelera).
- **`File.moveTo(carpeta)`** (al ligar una factura se mueven sus XML y PDF).
- **`getBlob()` con `getName()`, `getContentType()` y `getBytes()`** (`archivoGasto` de G; el blob de cada entrada de `Utilities.unzip`
  da `getName()` y `getBytes()`), y `Utilities.newBlob(bytes, mime, nombre)` + `Folder.createFile(blob)` para guardar.
- **`Utilities.base64EncodeWebSafe(Utilities.computeDigest(MD5, …))`** (`md5Gasto_`, la huella de un gasto de G; mismo formato que
  Apps Script: base64 con `-` y `_`, sin `=` al final después del `replace`).

## 7. Revisión 7c: ruta de importación (rama `incremento-7-fix-importar`)
Hallazgos de la revisión independiente (pruebas de concepto en `tests/revision7/`) y su arreglo; prueba: `tests/revision7-importar.test.js`.
1. **ZIP (bomba y memoria).** Antes los límites se revisaban después de inflar todo y el de 60 MB era por ZIP. Ahora `indiceZip` lee el
   directorio central sin inflar (entradas, tamaños declarados, ZIP64, descriptor de datos; rechaza índice roto, contraseña, varias
   partes, método que no sea guardado/deflate, encabezado local que no cuadra, entradas encimadas) y `entradasDeZip_` rechaza sin
   llamar a `Utilities.unzip` lo que no cabe en lo que le queda **al envío** (60 MB contando los sueltos, 400 archivos, 1,000 entradas).
   Después de inflar vuelve a medir: si salió más de lo que decía el índice, el ZIP se rechaza entero. La basura del ZIP no se guarda,
   `soltarBytesNoUsados` suelta al emparejar los bytes de lo que no se va a guardar (XML rechazados, PDF sin su XML, de más o
   pendientes) y los demás se sueltan al pasar a Drive.
2. **Un archivo malo ya no tumba el envío.** `datosFacturaCliente` arma (y `prepararLoteFacturasCliente` revisa por archivo, antes del
   candado y antes de crear nada en Drive) las celdas que salen del CFDI: ninguna de más de 45,000 caracteres (también `pagos (JSON)` y
   `relacionadas (JSON)`); los textos libres se recortan a los largos del SAT (`LARGO_CFDI_CLI`: nombre 254, serie-folio 70…). Los
   renglones se arman fuera del candado; adentro solo se escribe. Todo archivo creado en la llamada (`creados`) que no quedó en un
   renglón va a la Papelera en un `finally`: rechazado, repetido, el candado que no se tomó o una escritura que tronó. El PDF que venía
   con un XML que no se guardó dice lo mismo que su XML (`pdfComoSuXml`), no "PDF".
3. **Regla 7.** Todo texto del XML que va a la hoja pasa por `textoCelda` (serie-folio y forma de pago, con apóstrofo siempre). Un
   complemento de pago solo con pagos y documentos en MXN o USD (su propia `Moneda`, XXX como pide el SAT; se acepta también MXN/USD); el
   UUID de cada relacionado y de cada documento pagado, bien formado.
4. **Helgen → Helgen.** Un CFDI cuyo receptor es el RFC de Helgen (Config `EMPRESA_RFC`) no se importa como factura de cliente
   (I, E ni P), con su mensaje. El lado de gastos lo arregla su propia rama.
5. **Referencias del XML** (`atributosXml`, compartido con proveedores y gastos): una sola pasada de izquierda a derecha ("&#38;lt;" →
   "&lt;", no "<"); una referencia más allá de U+10FFFF o a una mitad de par sustituto → "El XML no es válido: trae una referencia a
   un carácter que no existe (…)" (antes un RangeError en inglés). Con XML válido, lo mismo que antes (comparado con la versión
   anterior en 20,000 valores al azar).
6. **Interfaz (`mod-facturas`).** Si actualizar la lista falla, el error se ve (aviso arriba y en el bloque, con "Intentar de nuevo") y
   lo de antes queda atenuado con "es de la última carga (hora) y puede no estar al día"; con `PERMISO` o `ACCESO` la lista se quita.
   Importar con éxito o volver a cargar quita el aviso.
