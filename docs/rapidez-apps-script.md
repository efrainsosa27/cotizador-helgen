# CAPRI más rápido en Apps Script (29/10/2026)

Rama `rapidez-apps-script` (sobre `incremento-5`, que todavía no se publica). **Nada se publicó**: ni `clasp push` ni `wrangler`.
Objetivo: que CAPRI responda más rápido **sin cambiar lo que hace**, mientras la API siga en Google Apps Script. Casi todo el
trabajo está en `Code.js`, que también va a correr en el servidor Node: cada lectura de Sheets que se ahorra aquí se ahorra allá.

## 1. Resumen

| Lo que hace la gente | Antes (s) | Después (s) | Cambio |
|---|---|---|---|
| Abrir una requisición (Compras) | 15.8 | 8.1 | −49 % |
| Registrar un pago a proveedor | 37.3 | 18.4 | −51 % |
| Cotizar una requisición (Compras) | 27.2 | 12.1 | −55 % |
| Visto bueno (emite la orden con PDF) · 2 llamadas | 47.1 | 30.2 | −36 % |
| Registrar lo que llegó (3 fotos) | 36.2 | 24.4 | −33 % |
| Pedir una requisición con cotización | 28.2 | 17.6 | −38 % |
| Guardar una cotización (PDF) | 15.0 | 12.3 | −18 % |
| Sincronizar tras un cambio de otra persona (Compras) | 28.1 | 8.0 | −71 % |
| Carga inicial de Compras en frío | 18.2 | 14.2 | −22 % |
| Activador de 15 minutos (sin nadie esperando) | 53.5 | 9.0 | −83 % |

**Estimaciones del modelo** (sección 2), con los ~1.7 s fijos de cada llamada incluidos. Sirven para comparar antes y después;
los segundos reales son menores en las escrituras (sección 2.3). Lo que vio la gente el 23–28/10 (p. ej. guardar con PDF ~15 s)
cuadra con el modelo.

Lo que **no** cambió: las 32 respuestas medidas y las 24 pestañas de los 5 libros al terminar (11 576 celdas) son iguales antes
y después (sección 2.4). Las pruebas (`bash tests/todas.sh`) siguen en verde, con `tests/rapidez.test.js` nueva.

## 2. Método

### 2.1 Perfil en el arnés

- `tests/arnes.js` acepta `{perfil: true}`: cada operación con un servicio de Google queda anotada con su tipo, la pestaña, las
  celdas, si se hizo con el candado tomado y (con `--detalle`) la función de `Code.js` que la hizo. Sin la opción no anota nada.
- `tests/perfil.js` siembra por `doPost` datos parecidos a los reales: 14 proyectos, 30 cotizaciones, 4 contratos (3 firmados,
  7 pagos), 120 productos, 6 proveedores con CSF y carátula, 42 requisiciones con el **flujo con aprobaciones** (el que está en
  uso): 12 recibidas, 8 pagadas, 6 autorizadas, 5 cotizadas, 5 aprobadas, 4 solicitadas y 1 de un proyecto ligado al centro de
  mando; 28 órdenes, 21 pagos, 10 facturas CFDI. Roles: compras (pedro), aprobaciones (tania), solo requisición (rosa),
  cobranza (efrain), super admin (leo), quien pide (obrero).
- Escenarios: carga inicial por rol en frío (caché vacío, como tras 6 h sin uso) y en caliente (tras el activador); abrir una
  requisición (Compras y Aprobaciones); lista de Compras; Pendientes; mis requisiciones; cuentas por pagar; sincronizar sin
  cambios y tras un cambio; el flujo pedir → aprobar → cotizar → visto bueno → pagar → recibir; factura CFDI; pago de cobranza;
  cotización con PDF; el activador de 15 minutos.
- **Pesos** (segundos por operación). Los dio Leo (medidos el 23–28/10): lectura de Sheets 0.5, escritura 0.3, crear en Drive
  1.5, caché 0.02, propiedades 0.05, candado 0. Supuestos míos: `getLastRow` 0.1, `getDataRange` 0.1, abrir un libro 0.1,
  formato 0.1, otra operación de Drive (buscar, mover, renombrar) 0.3, UrlFetch 0.3, correo 0.5, conversión HTML→PDF 4 (calibrado:
  con 4 s, guardar una cotización da 15.0 s con el fijo, como lo medido). Fijo por llamada: 1.7 s.
- **Antes** = la versión publicada `fd5c6d5` medida con **este mismo** perfil (misma siembra, mismos escenarios).

### 2.2 Cómo correrlo

```bash
node tests/perfil.js .                                   # tabla por escenario
node tests/perfil.js . --json despues.json --comparar antes.json
node tests/perfil.js . --detalle "abrir requisición"     # qué pestaña lee cada función, Drive, caché…
# Antes: el Code.js publicado con el perfil de ahora
mkdir -p /tmp/base/tests && git show fd5c6d5:Code.js > /tmp/base/Code.js && git show fd5c6d5:Logo.js > /tmp/base/Logo.js
cp tests/arnes.js tests/perfil.js /tmp/base/tests/ && (cd /tmp/base && node tests/perfil.js . --json /tmp/antes.json)
```

### 2.3 Límites del modelo

- Una lectura de 1 renglón pesa lo mismo que una pestaña completa (0.5 s). En la realidad un viaje chico a Sheets tarda menos,
  así que el ahorro real de quitar lecturas de encabezados (Rapidez 2 y 8) es menor que el estimado. El orden de lo que pesa
  más sí es confiable.
- El simulacro no tiene `getFormulas`, `getParent` ni `protect`: al abrir el catálogo, el arnés no cuenta la reparación de
  fórmulas de la columna I ni el tipo de cambio (≈ 3–4 lecturas reales más por apertura, antes y después).
- `getSheetId()` y `getName()` se tratan como gratis (Apps Script los trae con la pestaña). Si no lo fueran, Rapidez 2 y 5
  costarían un poco más de lo estimado.

### 2.4 Comprobación de que no cambió lo que hace

```bash
node tests/perfil.js . --respuestas despues-resp.json --estado despues-est.json   # y lo mismo con el Code.js publicado
node tests/perfil-comparar.js antes-resp.json despues-resp.json   # 32 comparados · 0 diferentes
node tests/perfil-comparar.js antes-est.json despues-est.json     # 1119 filas comparadas · 0 diferentes
```

`perfil-comparar.js` solo ignora lo que depende del reloj: fechas con hora (las dos corridas no son en el mismo segundo) y
huellas MD5 (la de una propuesta incluye su hora).

## 3. Antes y después por escenario

Operaciones por escenario (una llamada salvo donde se dice) y segundos estimados. «a → b» = antes → después.

| Escenario | Lecturas Sheets | Otras op. Sheets¹ | Escrituras | Drive (crear) | UrlFetch | Caché | Propiedades | Servidor (s) | Con fijo (s) | Con candado (s) |
|---|---|---|---|---|---|---|---|---|---|---|
| bootstrap compras (frío) | 22 → 19 | 34 → 18 | 0 | 0 (0) | 0 | 57 → 56 | 19 → 1 | 16.5 → **12.5** | 18.2 → **14.2** | — |
| bootstrap aprobaciones (frío) | 15 → 14 | 25 → 15 | 0 | 0 (0) | 0 | 48 → 46 | 17 → 1 | 11.8 → **9.5** | 13.5 → **11.2** | — |
| bootstrap solo requisición (frío) | 13 → 12 | 20 → 12 | 0 | 0 (0) | 0 | 37 | 13 → 1 | 9.9 → **8.0** | 11.6 → **9.7** | — |
| bootstrap cobranza (frío) | 15 → 14 | 25 → 15 | 0 | 0 (0) | 0 | 47 → 45 | 18 → 1 | 11.8 → **9.4** | 13.5 → **11.1** | — |
| bootstrap super admin (frío) | 22 → 19 | 34 → 18 | 0 | 0 (0) | 0 | 59 → 58 | 20 → 1 | 16.6 → **12.5** | 18.3 → **14.2** | — |
| bootstrap compras (caliente) | 0 | 0 | 0 | 0 (0) | 0 | 33 → 17 | 1 | 0.7 → **0.4** | 2.4 → **2.1** | — |
| bootstrap aprobaciones (caliente) | 0 | 0 | 0 | 0 (0) | 0 | 23 → 12 | 1 | 0.5 → **0.3** | 2.2 → **2.0** | — |
| bootstrap solo requisición (caliente) | 0 | 0 | 0 | 0 (0) | 0 | 21 → 12 | 1 | 0.5 → **0.3** | 2.2 → **2.0** | — |
| bootstrap cobranza (caliente) | 0 | 0 | 0 | 0 (0) | 0 | 21 → 11 | 2 → 1 | 0.5 → **0.3** | 2.2 → **2.0** | — |
| bootstrap super admin (caliente) | 0 | 0 | 0 | 0 (0) | 0 | 35 → 19 | 2 → 1 | 0.8 → **0.4** | 2.5 → **2.1** | — |
| abrir requisición (compras) | 22 → 10 | 26 → 12 | 0 | 0 (0) | 0 | 9 → 8 | 7 → 1 | 14.1 → **6.4** | 15.8 → **8.1** | — |
| abrir requisición (aprobaciones) | 8 → 4 | 10 → 6 | 0 | 0 (0) | 0 | 5 → 4 | 6 → 1 | 5.4 → **2.7** | 7.1 → **4.4** | — |
| lista de Compras (caliente) | 0 | 0 | 0 | 0 (0) | 0 | 9 → 5 | 1 | 0.2 → **0.1** | 1.9 → **1.8** | — |
| pendientes compras | 0 | 0 | 0 | 0 (0) | 0 | 13 → 7 | 1 | 0.3 → **0.2** | 2.0 → **1.9** | — |
| pendientes super admin (todos) | 0 | 0 | 0 | 0 (0) | 0 | 13 → 7 | 1 | 0.3 → **0.2** | 2.0 → **1.9** | — |
| mis requisiciones (solo requisición) | 0 | 0 | 0 | 0 (0) | 0 | 9 → 6 | 1 | 0.2 → **0.2** | 1.9 → **1.9** | — |
| cuentas por pagar | 0 | 0 | 0 | 0 (0) | 0 | 9 → 5 | 1 | 0.2 → **0.1** | 1.9 → **1.8** | — |
| sincronizar compras (sin cambios) | 0 | 0 | 0 | 0 (0) | 0 | 27 → 14 | 2 | 0.6 → **0.4** | 2.3 → **2.1** | — |
| sincronizar solo requisición (sin cambios) | 0 | 0 | 0 | 0 (0) | 0 | 21 → 10 | 2 | 0.5 → **0.3** | 2.2 → **2.0** | — |
| flujo 1 · guardarRequisicion (con cotización) | 29 → 13 | 34 → 18 | 7 | 4 (1) | 6 | 10 | 26 → 6 | 26.5 → **15.9** | 28.2 → **17.6** | 20.4 → **12.3** |
| sincronizar compras (tras un cambio) | 40 → 9 | 48 → 12 | 0 | 0 (0) | 0 | 48 → 26 | 12 → 2 | 26.4 → **6.3** | 28.1 → **8.0** | — |
| lista de Compras (tras un cambio) | 0 | 0 | 0 | 0 (0) | 0 | 9 → 5 | 1 | 0.2 → **0.1** | 1.9 → **1.8** | — |
| flujo 2 · aprobar (abre + aprueba; 2 llamadas) | 27 → 11 | 31 → 20 | 10 | 0 (0) | 0 | 10 → 8 | 20 → 5 | 21.3 → **11.4** | 24.7 → **14.8** | 11.2 → **6.2** |
| flujo 3 · cotizarRequisicion | 34 → 11 | 44 → 20 | 7 | 0 (0) | 0 | 9 → 7 | 27 → 4 | 25.5 → **10.4** | 27.2 → **12.1** | 19.5 → **7.3** |
| flujo 4 · visto bueno → orden con PDF (2 llamadas) | 46 → 19 | 53 → 31 | 14 | 3 (1) | 5 | 14 → 11 | 31 → 8 | 43.7 → **26.8** | 47.1 → **30.2** | 30.9 → **19.4** |
| flujo 5 · registrarPagoProveedor | 46 → 15 | 51 → 24 | 6 | 4 (1) | 6 | 7 → 6 | 21 → 7 | 35.6 → **16.7** | 37.3 → **18.4** | 35.2 → **16.5** |
| flujo 6 · registrarRecepcion (3 fotos) | 34 → 15 | 39 → 25 | 10 | 4 (3) | 10 | 10 → 8 | 24 → 7 | 34.5 → **22.7** | 36.2 → **24.4** | 27.2 → **18.9** |
| registrarFacturaProveedor (CFDI) | 35 → 14 | 41 → 20 | 2 | 4 (1) | 6 | 7 → 6 | 21 → 5 | 27.9 → **14.5** | 29.6 → **16.2** | 26.1 → **13.6** |
| registrarPago (cobranza) | 19 → 9 | 23 → 12 | 2 | 3 (1) | 5 | 9 → 8 | 15 → 5 | 17.2 → **10.6** | 18.9 → **12.3** | 16.9 → **10.4** |
| guardarCotizacion (PDF) | 9 → 6 | 14 → 8 | 1 | 2 (1) | 0 | 7 | 17 → 5 | 13.3 → **10.6** | 15.0 → **12.3** | 10.4 → **9.1** |
| activador cadaQuinceMinutos (tras escrituras) | 82 → 12 | 97 → 16 | 0 | 0 (0) | 1 | 67 → 40 | 24 → 6 | 53.5 → **9.0** | (sin fijo) | — |

¹ `getLastRow`, `getDataRange`, abrir libro y formato. Correo y PDF no cambian (1 PDF en cotización y visto bueno; los correos se
mandan igual). Tamaño de las respuestas: igual en todos los escenarios (p. ej. 75 KB la carga de Compras en caliente, 94 KB la de
solo requisición; ver 9.2).

## 4. Qué cambió (un commit por mejora)

| Commit | Qué | Por qué era lento | Ahorro (estimado) |
|---|---|---|---|
| `19902a0` Rapidez 0 | Perfil en el arnés (`tests/perfil.js`) | — | — |
| `311d471` Rapidez 1 | IDs de Script Properties (`idGuardado_`), libros abiertos (`abrirLibro_`) y `getLastRow` (`filasDatos_`) una vez por petición | `getProperty` por cada uso (hasta 27 en una llamada), la base de datos se abría hasta 3 veces, 2 `getLastRow` por pestaña | ~10 % en casi todo |
| `833bb31` Rapidez 2 ⚠ | Encabezados revisados una vez (petición y 6 h): `encabezadosRevisados_` | `hojaDeArea_` leía la fila 1 en cada uso de una pestaña (hasta 4 veces la misma en una llamada; ~20 lecturas al pagar a un proveedor) | pago 32.5 → 21.0 s |
| `7c54a15` Rapidez 3 ⚠ | Filas de cada pestaña una vez por petición (`MEMO_.filas`, `escribe_`, `candado_`) | La misma pestaña completa se leía hasta 4 veces en una llamada (Requisiciones al sincronizar compras) | sincronizar tras un cambio 14.1 → 8.1 s; activador 27.6 → 10.2 s |
| `494a015` Rapidez 4 ⚠ | Config una lectura; `configLigera_` y la carpeta del área una vez por petición | `getConfig_` leía Config dos veces; en escrituras Config se leía en cada `sitios_()` (4 al recibir); la carpeta de compras se buscaba y revisaba 2 veces | −0.6 s en cargas en frío; −1.2 s al recibir |
| `7e2198a` Rapidez 5 ⚠ | Escribir en una pestaña olvida solo esa pestaña | Con Rapidez 3, cada escritura obligaba a releer todo (Proyectos 4 veces en el visto bueno) | −1 a −3 s por escritura |
| `b874b3b` Rapidez 6 | Interfaz: tras guardar una cotización, `sincronizarAhora()` en lugar de `getClientes` + `listarProyectos` | Dos llamadas (2 × 1.7 s fijos) | una llamada menos por cotización |
| `0be1fa2` Rapidez 7 ⚠ | Vistas de compras con `contratosCache_()` | Abrir una requisición leía Contratos completa (y abría el libro de cobranza) por la moneda | −0.6 s al abrir una requisición |
| `66dc597` Rapidez 8 ⚠ | Encabezados de Cotizaciones y del catálogo con la revisión de 6 h | Fila 1 de Cotizaciones con el candado tomado en cada cotización; G1:H1 e I1 del catálogo en cada apertura | 1–3 lecturas por cotización |
| `afb6f74` Rapidez 9 ⚠ | Caché: valor chico en la misma entrada (`V:<json>`) | Todo valor costaba 2 viajes (marca `N:n` + trozos) | sincronizar sin cambios 27 → 16 op.; carga en caliente 33 → 17 |
| `bf467f4` Rapidez 10 ⚠ | Sincronizar revisa Permisos con lo ya traído | Permisos y Delegaciones se pedían 2 veces al caché | 16 → 14 op. por consulta |
| `4dde0b4` Rapidez 11 ⚠ | Corrección: una fuente leída en la petición solo se reusa con la misma versión | Carrera que ya existía (ver 5.3) | correctitud, no velocidad |
| `d336e9e`, `51e3145` | Perfil: pila completa, carpeta de compras como en Drive, `--respuestas`/`--estado`, `tests/perfil-comparar.js` | — | — |
| `9c0b96a` Rapidez 12 ⚠ | Corrige Rapidez 2: si la fila 1 se dio por buena sin leerla, la primera escritura en esa pestaña revisa (con `getLastRow`) que no esté vacía y, si lo está, repone los encabezados | Con Rapidez 2, una pestaña vaciada a mano recibía el siguiente renglón en la fila 1 | +0.1 a +0.6 s por escritura |

⚠ = toca lo que se reusa o se guarda (caché o memoria de la petición): **revisar con cuidado** (sección 5). Los ahorros de esta
tabla se midieron al hacer cada commit (con el perfil de ese momento); la tabla de la sección 3 es la comparación final.

## 5. Lo que toca caché o invalidación (para revisar con cuidado)

### 5.1 Entre peticiones (CacheService)

- **Rapidez 2 y 8 · encabezados revisados (`ENCABEZADOS_OK`, 6 h).** Solo evita leer la fila 1. Clave = libro + pestaña + id de
  la pestaña + firma de los encabezados esperados; cada anotación vence 6 h después de hecha aunque el mapa se vuelva a guardar.
  Se revisa siempre si la pestaña la acaba de crear el código, si una versión nueva espera otras columnas o si alguien borró la
  pestaña y la volvió a crear (otro id). **Único cambio:** si alguien cambia o borra a mano la fila de encabezados de una pestaña
  que ya existe, se repara a más tardar 6 h después (antes, en la siguiente llamada). Las filas se leen por posición: no cambia
  lo que se lee. Si alguien **vacía** a mano la pestaña completa (con encabezados) sin borrarla, Rapidez 12 lo cubre: cuando la
  fila 1 se dio por buena sin leerla, la primera escritura de la petición en esa pestaña revisa con `getLastRow` que no esté
  vacía y, si lo está, repone los encabezados antes de escribir (como antes; sin eso, el siguiente renglón caía en la fila 1).
- **Rapidez 9 · formato del caché.** Mismas versiones y tiempos de vida; cambia cómo se guarda un valor chico. `leerCache_` sigue
  leyendo el formato en trozos (`N:n`), que es el de los valores grandes. Lo que dejó el código publicado antes ya no se lee
  (revisión 3, abajo).
- **Revisión 3 · espacio del caché por publicación (`VERSION_CODIGO_CACHE`, hoy `2026-10-29r`).** Antes, al publicar, el código
  nuevo servía las listas que había guardado el anterior (mismas claves) mientras no subiera la versión de su colección: hasta 6 h
  sin los campos nuevos (con esta rama: devoluciones, pago parcial, fotos…). Ahora toda clave de datos entre peticiones lleva al
  final `@<VERSION_CODIGO_CACHE>` (`claveNs_`): `leerCache_`/`guardarCache_` (listas `K_`, fuentes `F_`, `PORTAL_ITEMS`), huellas
  `H_` y marcas `R_`, `ENCABEZADOS_OK`, `ACCESO_FOTOS`, tokens verificados `TOK_` y sugerencias SAT. No lo llevan las claves de
  idempotencia (`REQ_`, `OC_`, `PGP_`…: un reintento justo al publicar devuelve el mismo folio), las de la entrada con código
  (`CAPRI_*`: bloqueos y códigos vigentes) ni `FOTOCM_` (fotos ya archivadas). Se cambia en cada publicación que cambie la forma
  de algo en caché (CLAUDE.md §8). Costo al publicar: la primera carga de cada lista se arma de las hojas y cada sesión verifica su
  token otra vez. Prueba: §16 (también revisa que toda clave de datos que escribe el código lleve el espacio).
- **Rapidez 7 · vistas de compras con `contratosCache_()`.** En una consulta: caché por versión de contratos (marcar aceptada,
  firmar o desbloquear suben la versión). Un cambio **a mano** en Contratos lo detecta la sincronización en ≤ 10 min, igual que en
  las listas (`listarProyectosCompras` ya lo hacía así). En una escritura se lee la hoja (como antes).
  **Revisión 4:** al detectarlo, `sincronizar` ahora también vuelve a mandar la requisición abierta (`ctx.req`; antes solo las
  órdenes del proyecto). Los ≤ 10 min se quedan (es el costo de no leer Contratos en cada vista) y se avisan en CLAUDE.md §6.14:
  en ese rato la vista muestra la moneda de antes, pero autorizar con ella se rechaza («El proyecto es en USD y la orden en MXN:
  captura el tipo de cambio…»), así que no hay monto equivocado. Prueba: §13.

- **Revisión 5 · la versión siempre sube.** `subirVersiones_` era leer-sumar-escribir con el candado de script y, si no lo
  conseguía en 10 s, **no subía** (solo un aviso en el registro). El candado se queda 9–19 s con un PDF, así que pasaba en horas de
  trabajo, y Rapidez 6 depende de la subida (tras guardar una cotización la interfaz pide `sincronizar` en lugar de `getClientes`):
  sin ella, ni quien guardó ni los demás veían al cliente nuevo hasta otra escritura. Se eligió quitar el candado en lugar de
  reintentar: cada colección toma un valor que no se repite (`versionNueva_`: segundos × 10⁶ + 6 cifras al azar; mayor que el
  anterior conocido) y se escribe sin leer-sumar-escribir, así que dos subidas a la vez dan valores distintos y ninguna se pierde
  (con reintentos, un PDF largo todavía podía agotarlos y además se alargaba cada llamada). Se revisaron todos los usos: las
  versiones solo se comparan por igualdad (clave de caché `K_…`, `sincronizar`, la huella `H_` de `fuenteConHuella_`; la interfaz
  solo las guarda y las regresa) y siguen siendo enteros exactos (≈1.8 × 10¹⁵), así que nada más cambia; las pruebas que piden
  «subió» (`>`) siguen valiendo porque una subida seguida sale mayor. Riesgo que queda: dos subidas de la misma colección en el
  mismo segundo con las mismas 6 cifras (1 en un millón) darían la misma versión. Prueba: §15.

### 5.2 Dentro de una petición (`MEMO_`)

- **Rapidez 3 y 5 · `MEMO_.filas`.** Garantía: nunca se usa una fila guardada después de que algo pudo cambiarla.
  - Toda escritura de `Code.js` pasa por `escribe_(hoja)` (las 125 que había, cambio mecánico revisado a mano). Olvida lo guardado de
    esa pestaña; si recibe un libro (`insertSheet`, `deleteSheet`) o algo que no es pestaña, olvida todo.
    `tests/rapidez.test.js` §3 **falla si una escritura no pasa por `escribe_`** (`tests/escrituras.js` encuentra cada una, también
    las nuevas que se agreguen).
  - Todo candado pasa por `candado_()`, que olvida todo al tomarlo y al soltarlo (adentro se relee lo que otra persona pudo
    cambiar mientras se esperaba). La misma prueba exige que solo `candado_` llame a `LockService.getScriptLock()`.
  - **Revisión 6 · candados anidados.** El candado de Apps Script es uno por ejecución y `releaseLock` lo suelta completo aunque
    se haya tomado dos veces. Un `candado_` dentro de otro (el libro del área o la base de datos que se crean la primera vez,
    `migrarConfig_`, con el candado ya tomado) lo soltaba al terminar y lo que seguía en el de afuera (folio, escritura) corría
    sin candado. Ahora `candado_` lleva la cuenta (`CANDADO_TOMADO_`, en 0 al empezar cada `doPost`): el de adentro no lo pide
    otra vez ni lo suelta (tampoco olvida las filas: nadie más pudo escribir); solo el de afuera lo suelta. El arnés simula un
    solo candado por ejecución que se suelta completo. Prueba: §14.
  - Cada vez que se leen las versiones (`versiones_`) se olvida todo: una lista que se guarda con una versión se arma con filas
    leídas después de esa versión.
  - El arnés **falla cualquier prueba** que escriba en una pestaña mientras el código guarda filas de esa pestaña (comprobado:
    quitar `escribe_` de `cambiarReq_` hace fallar revision5, recepcion y anular).
  - Se reparten copias: quien recibe filas puede cambiarlas sin tocar las de los demás.
  - Supuesto (Rapidez 5): escribir en una pestaña no cambia lo que se lee de otra. Vale para las que se guardan (compras,
    cobranza, administración y Proyectos: sin fórmulas entre pestañas).
- **Rapidez 4 · `configLigera_` y `carpetaArea_` por petición.** Config ya leída se olvida al escribir en Config (`escribe_`),
  al tomar o soltar el candado y al leer las versiones; la carpeta del área se vuelve a buscar y revisar en cada petición.
- **Rapidez 10 · revisar fuentes.** Si la fuente ya está en la petición con la misma versión, basta la marca `R_` para saber si
  toca releer la hoja; si toca, se relee como antes.
- **Revisión 1 · memos derivados (`MEMOS_DERIVADOS_`).** Lo que se arma con filas de una pestaña y se guarda en `MEMO_`
  (`devs` ← Devoluciones, `pagosProv` ← PagosProveedores, `anulados` ← Anulaciones, `ctxRoles`/`rolesYo` ← Permisos y
  Delegaciones, `cfgLigera` ← Config) se olvida como las filas: al leer las versiones, al tomar o soltar el candado y al escribir
  en su pestaña (`escribe_`). Antes solo `cfgLigera`: el activador guardaba «mis requisiciones» con la versión nueva y una
  devolución ya resuelta como Abierta. Excepción a propósito: los roles se conservan al tomar el candado (una vez por llamada,
  como siempre; recalcularlos dentro de una escritura releería Permisos y Delegaciones, ~1 s). El arnés también falla una
  escritura en la pestaña de un memo derivado que sigue guardado. Prueba: §11.

### 5.3 Rapidez 11: corrección de una carrera que ya existía

`fuenteConHuella_` reusaba toda la petición el valor de una fuente (proyectos, contratos, catálogo, clientes, permisos).
`sincronizar` lee las fuentes y luego vuelve a leer las versiones: si otra petición escribía en medio, las listas por versión que
usan esa fuente (mis requisiciones, Compras, Pendientes, operaciones, resumen de cobranza, devoluciones) se armaban con el valor
de antes **y se guardaban con la versión nueva**, hasta 6 h. Reproducido también con la versión publicada. Ahora el valor solo se
reusa con la misma versión. Sin carrera, nada cambia. Prueba: §10 (falla sin el arreglo).

**Revisión 2 (la misma carrera, dentro de `fuenteConHuella_`).** Cuando la consulta de fondo relee una hoja y ve otra huella, sube
la versión y guardaba lo que había leído **antes** de subirla. Si otra ejecución escribía en medio (por ejemplo, creaba un
proyecto y subía ella la versión), ese dato viejo quedaba con la versión de después: todos dejaban de ver el proyecto nuevo hasta
la siguiente revisión de la hoja. Ahora, después de subir y leer la versión, se vuelven a leer la hoja y la huella (una lectura
más, solo cuando alguien editó la hoja a mano). Prueba: §12.

## 6. Ruta del PDF (guardar cotización y emitir orden)

### 6.1 De qué está hecho (después de los cambios)

| | Guardar cotización | Visto bueno (emite la orden) |
|---|---|---|
| Conversión HTML→PDF | ~4 s | ~4 s |
| Crear el archivo en Drive | 1.5 s | 1.5 s |
| Buscar carpetas (año / proyecto / subcarpeta) | 2 búsquedas (0.6 s) | 3 (0.9 s) |
| Restringir (API de Drive) | — (las cotizaciones las ve el dominio) | 5 llamadas: carpeta de compras, año, proyecto (revisar) + el PDF (revisar y quitar el dominio) ≈ 1.5 s |
| Lecturas y escrituras de Sheets | 6 lecturas, 1 escritura (antes 9) | 19 lecturas, 14 escrituras (antes 46) |
| Con el candado tomado | 9.1 s (antes 10.4) | 19.4 s (antes 30.9) |

### 6.2 Qué se quitó y qué no

- Se quitó lo que se repetía: Config leída dos veces, la fila 1 de Cotizaciones con el candado tomado, encabezados del catálogo,
  la carpeta de compras revisada dos veces, y todas las lecturas repetidas de pestañas (Rapidez 1–5, 8).
- **No se tocó** (necesario o con riesgo):
  - La conversión y la creación del archivo: son el trabajo.
  - Restringir el PDF (`privado_`: revisar y quitar el permiso del dominio): sin eso el archivo queda abierto a helgen.tech.
  - Revisar la cadena de carpetas en cada subida. *Opción:* anotar 6 h que una carpeta ya está restringida y, si al restringir
    el archivo Drive responde 403 por permiso heredado, rehacer la cadena sin anotación y reintentar. Ahorra 3 llamadas por
    subida (~0.5–1 s). **No la hice:** si alguien vuelve a compartir una carpeta, hoy se corrige en la siguiente subida; con la
    anotación depende de que Drive siempre responda 403 en ese caso (así lo vimos el 20/10/2026, pero no está garantizado). Es
    una decisión de seguridad, no de rapidez.
  - Juntar las llamadas de permisos en una sola (API por lotes de Drive): sin orden garantizado entre ellas (hay que restringir
    de arriba abajo) y sin forma de probarlo aquí.
- **PDF asíncrono (opción, no implementada).** Responder sin esperar el PDF y generarlo en segundo plano (activador) le quitaría
  ~6 s a guardar una cotización (de ~12 s a ~6 s) y unos 6–7 s al visto bueno. Cambia lo que ve la gente: la liga «Abrir PDF» y el
  PDF en Drive no estarían en la respuesta, sino minutos después; el correo/aviso al proveedor tendría que esperar al PDF; un
  error del conversor ya no se vería al guardar. Por eso no se hizo.
- **Generar el PDF fuera del candado (opción, no implementada).** Reservar el folio con el candado, soltarlo, generar el PDF y
  volver a tomarlo para escribir. No acorta la espera de quien guarda (solo la de otros que esperan el candado) y cambia los
  casos de error: folios que se gastan sin registro si el PDF falla o si otra persona cambió la requisición en medio, y archivos
  sueltos en Drive.

## 7. Lo que se descartó y por qué

- **Armar la vista de respuesta después de soltar el candado.** Medido: armar la vista (requisición, mis requisiciones…) es 20–45 %
  del tiempo con candado de una escritura (1.9–6.2 s estimados). Moverla no acelera a quien guarda, solo a quien espera el
  candado. Cambia qué regresa en carreras: una requisición que un super admin anula justo después regresaría error aunque el pago
  sí se guardó, y un reintento recibiría la vista del momento. Queda lista como opción: guardar en la respuesta una nota
  `{tipo, folio}` dentro del candado (la idempotencia la guarda tal cual) y que `conCandado_` la cambie por la vista al soltarlo.
- **Buscar las carpetas antes del candado.** Igual: acorta el candado (~1.8 s por subida) pero no la espera; crearía carpetas
  vacías cuando la escritura después falla.
- **Guardar en caché por versión las filas crudas o las vistas de detalle.** Abrir una requisición bajaría a casi cero lecturas,
  pero: (1) hoy la vista de detalle siempre lee la hoja, y un cambio a mano en las pestañas de compras no sube ninguna versión;
  (2) con la clave de todas las versiones el acierto sería bajo (cualquier escritura la invalida); con una clave por pestaña
  habría que mantener a mano qué funciones escriben qué pestaña: el mismo problema de declarar `cambios`.
- **Leer varias pestañas en una llamada (API de Sheets `batchGet`).** Devuelve fechas como texto o número, no como `Date`;
  `fechaTexto_`/`fechaIso_` y muchas comparaciones dependen de `instanceof Date`. Vale la pena en el servidor (sección 8).
- **Usar el caché de Config (10 min) también en las escrituras.** Cambiaría qué lista de sitios valida una escritura tras un cambio
  a mano. Se hizo solo por petición (Rapidez 4).
- **Quitar la reparación de fórmulas de la columna I del catálogo al guardar una cotización.** Es un efecto que se ve en la hoja;
  se deja como está.
- **Recortar lo que mandan las listas.** La interfaz muestra todo lo que llega (renglones, «lo que se compra», avance y eventos de
  cada requisición, también de las cerradas): recortar cambiaría lo que se ve. Ver 9.2.
- **Juntar `misArticulos` en la respuesta de `guardarRequisicion`.** Ahorra una llamada de fondo (nadie la espera) a cambio de más
  trabajo con el candado.
- **Guardar el logo de Drive en caché.** Solo aplica si `LOGO_FILE_ID` tiene valor (está vacío).

## 8. Lo que solo arregla la mudanza al servidor

- Los ~1.7 s fijos por llamada (redirección de Google + arranque del script) y los ~9 s de la primera llamada tras publicar (se
  cargan ~750 KB de código en cada ejecución).
- La latencia de cada viaje a Sheets: en Node se pueden leer varias pestañas en una llamada (`batchGet`) y, en la segunda etapa,
  dejar Sheets por PostgreSQL. Lo de esta rama ya cuenta allá: menos lecturas por llamada.
- Un solo candado para todas las escrituras: en el servidor, candados por registro o transacciones.
- La conversión HTML→PDF de Google (~4 s) y el PDF dentro de la escritura: en el servidor, un generador propio y, si se quiere,
  en una cola.
- CacheService (100 KB por valor, 6 h máximo, ~20 ms por viaje): Redis o memoria del proceso. Rapidez 9 y 10 son ahorros propios
  de Apps Script (inofensivos allá).
- La consulta cada 20 s por pestaña: en el servidor, avisos empujados (SSE/websocket) en lugar de preguntar.
- Restringir cada archivo con dos llamadas a la API de Drive.

## 9. Hallazgos que no se cambiaron

1. **Permisos cambiados a mano:** la consulta que detecta el cambio todavía regresa los permisos de antes; la siguiente (≤ 20 s) y
   cada función ya usan los nuevos. Igual en la versión publicada (§9 de la prueba lo fija).
2. **Listas sin límite:** «mis requisiciones» manda todas las requisiciones de la persona con todo su detalle (~2.4 KB cada una;
   80 KB para quien recibe 30). El caché guarda hasta 30 trozos (~900 KB): pasado eso, `guardarCache_` deja de guardarla **sin
   aviso** y cada carga y sincronización la arma de las hojas. Con ~370 requisiciones por persona se llega ahí. Opción (cambia la
   interfaz): mandar completas solo las abiertas y las cerradas de los últimos N días, y el resto al pedirlo.
3. **Tras guardar una requisición**, el módulo del centro de mando pide `misArticulos` aparte (una llamada de fondo).

## 10. Pruebas y cómo publicar

- `bash tests/todas.sh` en verde (incluye `tests/rapidez.test.js`: 10 secciones, una por mejora con comportamiento sutil, y una
  por cada hallazgo de la revisión independiente).
- Simulacros extendidos con métodos que existen en Apps Script: `getSheetId`/`getName` (arnés), `getId` (cotizacion, sesion).
- **No publicado.** Esta rama sale de `incremento-5` (sin publicar): publicar las dos juntas o `incremento-5` primero. API:
  `npx clasp push --force` y nueva versión del deployment como facilities@ (§8 de CLAUDE.md). Interfaz (solo Rapidez 6):
  `CLOUDFLARE_ACCOUNT_ID=… npx --yes wrangler@4 deploy`. No hace falta correr nada desde el editor ni permisos nuevos.
- Al publicar, el caché que dejó la versión anterior **no** se usa: `VERSION_CODIGO_CACHE` = `2026-10-29r` (revisión 3). La primera
  carga de cada lista se arma de las hojas (como con el caché vacío: ~5 s el bootstrap, 9 s la primera ejecución). Si se publica
  otra vez con cambios en algo que se guarda en caché, cambiar el valor antes (CLAUDE.md §8).
