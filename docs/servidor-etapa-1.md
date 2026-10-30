# CAPRI — Etapa 1: servidor propio con los mismos Sheets y Drive

Diseño técnico y prototipo (rama `servidor-etapa-1`, 29/10/2026). Plan aprobado por Leo el 28/10: en la etapa 1 solo se
muda la API; Sheets y Drive se quedan; la interfaz solo cambia la dirección a la que llama. Servidor: **helgensrvr** (el
mismo de `drogheda.helgen.online` y `git.helgen.online`; Ubuntu 26.04 LTS, 64 núcleos, 60 GiB, Docker 29.7.2, sin Node),
decidido por Leo el 29/10. `capri.helgen.online` → 177.245.114.6 (esa máquina) desde el 29/10.

**Decidido (29/10):** solo el programa se muda, **en Docker detrás de nginx** en `capri.helgen.online`; Google Sheets sigue
siendo el almacén de registros en la etapa 1 (PostgreSQL en la etapa 2); los archivos se quedan en Drive para siempre; las
pantallas siguen en Cloudflare (cambia `API_URL` el día del cambio). Identidad: **token OAuth de facilities@** de una app
Interna, en dos tokens (§7); **nunca** una llave de cuenta de servicio. Efrain está de acuerdo.

**Para operar:** Google paso a paso → [`servidor-google-paso-a-paso.md`](servidor-google-paso-a-paso.md); comandos en
orden (Gibran / Leo / verificación) → [`servidor-comandos.md`](servidor-comandos.md).

> **En una frase.** `Code.js` corre **sin cambios** en un servicio de Node: cada petición entra a un trabajador (hilo) que
> tiene `Code.js` cargado con una imitación síncrona de los servicios de Apps Script; las lecturas salen de una copia en
> memoria de los libros, las escrituras se juntan y se mandan a Google en **una** llamada atómica por libro al soltar el
> candado, y lo que `Code.js` necesita en el momento (Drive, HTTP, PDF, correo) se hace síncrono con un puente
> (`Atomics.wait`). Nunca contesta "listo" sin que Sheets lo haya guardado.

Contenido: [1 Resumen](#1-resumen) · [2 Arquitectura](#2-arquitectura) · [3 El problema síncrono](#3-el-problema-síncrono-y-la-estrategia-elegida) ·
[4 Servicios de Apps Script](#4-cada-servicio-de-apps-script-y-su-reemplazo) · [5 Consistencia, concurrencia y fallas](#5-consistencia-concurrencia-y-fallas) ·
[6 Sesión](#6-sesión-verificación-local-del-token-de-google-y-sesiones-capri) · [7 Identidad de Google del servidor](#7-identidad-de-google-del-servidor) ·
[8 Secretos](#8-secretos) · [9 Script Properties](#9-script-properties--archivo-json) · [10 Despliegue](#10-despliegue-en-helgensrvr-docker-detrás-de-nginx) ·
[11 Memoria y CPU](#11-presupuesto-de-memoria-y-cpu) · [12 Sombra, cambio y regreso](#12-corrida-de-sombra-cambio-y-regreso) ·
[13 Costura en Code.js](#13-costuras-en-codejs) · [14 Riesgos](#14-riesgos-y-desconocidos) · [15 Lo que falta](#15-lo-que-falta-hasta-la-corrida-de-sombra) ·
[16 Pruebas](#16-pruebas-y-cómo-correrlas)

---

## 1. Resumen

| | |
|---|---|
| **Estrategia** | (c) híbrida: **memoria primero + diario por libro confirmado al soltar el candado + puente síncrono** para lo que `Code.js` usa al instante. Detalle y números en §3. |
| **Code.js** | Sin cambios para el servidor. Una costura opcional para el cambio: `API_MUDADA` (§13). |
| **Despliegue** | Contenedor Docker (`servidor/Dockerfile`, `servidor/docker-compose.yml`) solo en `127.0.0.1:8090`, detrás de nginx con certbot (§10). Sin Node ni systemd en el servidor. |
| **Escritura** | Lo que Code.js escribe queda en Sheets como lo dejaría Apps Script (entrada USER_ENTERED: números, fechas, `'`, `+52…`, fórmulas, booleanos), según el locale del libro y el formato de la celda (§4.4). |
| **Interfaz** | Solo `API_URL` → `https://capri.helgen.online/api`. Mismo contrato que `doPost` (POST `text/plain`, `{funcion, args, token}` → `{ok, datos \| error, codigo}`). |
| **Paridad** | El escenario bootstrap → requisición → autorizar → pagar → recibir (31 llamadas, 8 con error esperado) da **respuestas idénticas** por el arnés directo y por HTTP contra el servidor; también hojas, archivos, carpetas (con su acceso) y correos. |
| **Tiempo en el proceso** | 1–35 ms por llamada sin red (el arnés directo: 0.2–8 ms). Con Google simulado: lecturas p50 2 ms / p95 5 ms aun con 3 guardados a la vez; un guardado 2.3–3.6 s, dominado por las llamadas a Google. |
| **Metas** | Clic < 0.5 s: sí (hoy 1.6–2 s fijos de Apps Script). Guardar 1–3 s: sí en simulación (2.3–2.8 s), salvo "Recibí el material" con fotos y 2 correos (3.6 s; §3.4 dice cómo bajarlo). Guardar con PDF 3–5 s: 2.8 s en simulación (PDF real sin medir). |
| **Falta para la sombra** | ~4–6 días de trabajo + lo que pone Leo (§15). |

## 2. Arquitectura

```
 Navegador (interfaz en Cloudflare, igual que hoy; solo cambia API_URL)
        │ POST text/plain {funcion, args, token}
        ▼
 nginx  capri.helgen.online :443  (certbot, CORS solo Cloudflare, límite por IP, 50 MB, JSON si el servicio se reinicia)
        │ 127.0.0.1:8090 (Docker publica solo ese puerto del servidor)
        ▼
┌──────────────── contenedor capri (Docker; Node 22, Chromium; usuario 10001, raíz de solo lectura) ────────────────┐
│ HILO PRINCIPAL (asíncrono)                                                              │
│  http.js ── pool.js (cola; siempre deja un trabajador para lecturas; corte a los 120 s)  │
│  candado.js       el candado de script (uno, en orden de llegada)                       │
│  espejo-central   copia canónica de los libros; confirma diarios; sondeo y reconciliación│
│  almacen.js       Script Properties (JSON 600) · CacheService (memoria + disco cada 30 s) │
│  identidad.js     ID token de Google verificado aquí (JWKS)                             │
│  servicios.js     Drive (con memoria de 60 s) · UrlFetch · correo (cuota) · PDF · activadores│
│  backends/google  Sheets · Drive · Gmail con @googleapis/*  │  backends/memoria (pruebas) │
│        ▲  puente: MessagePort + Atomics.notify                                           │
│        │                                                                                 │
│ TRABAJADORES (3 hilos; cada uno con su vm)                                               │
│  Logo.js + Code.js tal cual │ fachada/: SpreadsheetApp, DriveApp, LockService, Cache,    │
│  PropertiesService, UrlFetchApp, MailApp, Utilities, Session, ScriptApp, ContentService   │
│  espejo local (copia de los libros) + diario de la transacción en curso                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
        │ Sheets API · Drive API · Gmail API (como facilities@helgen.tech)
        ▼
 Google: los mismos libros (base de datos, catálogo, compras, cobranza, Administración) y carpetas
```

**Una lectura** (bootstrap, listas, vistas): el trabajador aplica las copias nuevas que le mandó el principal, corre
`doPost` y lee del espejo local: no sale del proceso salvo por caché y propiedades (memoria del principal, ~0.05 ms por
llamada) y por Drive si `Code.js` lo pide.

**Una escritura** (p. ej. `autorizarRequisicion`):
1. `Code.js` llama `LockService.getScriptLock().tryLock(30000)` → el trabajador pide el candado al principal y se bloquea.
   Al entregarlo, si pasaron más de 15 s desde la última revisión, el principal revisa en Drive si alguien editó un libro
   a mano (≈120 ms) y lo relee. El trabajador aplica las copias nuevas: **dentro del candado ve lo último de Sheets**.
2. `getValues`/`setValues`/`appendRow`… van al espejo local al instante (el código lee lo que acaba de escribir) y cada
   escritura se anota en el diario del libro. `SpreadsheetApp.flush()` no hace nada (ver §4).
3. Drive (carpeta, PDF), `privado_` (permisos), el PDF y la API de Claude se hacen en el momento por el puente: `Code.js`
   usa su resultado (id, liga, código HTTP, bytes) en la línea siguiente.
4. `releaseLock()` → **confirmación**: el principal traduce el diario de cada libro a **una** `spreadsheets.batchUpdate`
   (todo o nada) que regresa las filas tocadas tal como quedaron. Solo si todos los libros llegaron, aplica lo que se
   escribió en propiedades y caché dentro del candado (folios, idempotencia) y manda a los demás trabajadores las hojas
   que cambiaron. Si algo falla, `releaseLock()` lanza el error: `doPost` contesta `{ok:false, codigo:"GUARDAR"}`.
5. Después del candado, `Code.js` manda los correos (Gmail) y los avisos al centro de mando (como hoy, regla 17).

**Archivos del prototipo** (`servidor/`):

| Archivo | Qué hace |
|---|---|
| `src/index.js`, `src/servicio.js`, `src/http.js` | Arranque con `/etc/capri/capri.json` (en el contenedor; `CAPRI_HOST`/`CAPRI_PUERTO` lo ajustan), armado del servicio, contrato HTTP de `doPost`, CORS, `/salud`. |
| `src/pool.js`, `src/trabajador.js`, `src/puente.js` | Trabajadores, contexto de `vm` con `Code.js`, puente síncrono (`Atomics.wait` + `receiveMessageOnPort`). |
| `src/fachada/*.js` | Los servicios de Apps Script (síncronos) sobre el espejo y el puente. |
| `src/espejo/modelo.js` | Modelo de un libro (con su locale y el formato de texto plano por tramos), operaciones del diario, fechas ↔ número de serie, A1, parches con revisión. |
| `src/espejo/entrada.js` | Cómo guarda Sheets lo que escribe Apps Script (USER_ENTERED), §4.4. |
| `src/nucleo/*.js` | Candado, espejo canónico, almacenes, identidad, Drive con memoria, salida HTTP, correo, PDF, activadores, registro. |
| `src/backends/google/*.js` | Sheets (carga acotada, diario → `batchUpdate`, lectura de regreso), Drive, Gmail, credenciales. |
| `src/backends/memoria.js` | Google simulado con la semántica de `tests/arnes.js` (paridad) y latencia opcional (mediciones). |
| `Dockerfile`, `docker-compose.yml`, `/.dockerignore` | La imagen (etapas `deps`, `app`, `pruebas`) y cómo corre (§10.2). |
| `herramientas/` | `autorizar.js` (tokens de facilities@), `sombra.js` (corrida de sombra), `propiedades.js` (importar de Drive o de un archivo, comparar), `admin.js` (salud y "Ejecutar" dentro del contenedor), `paridad-escritura.js` (la tabla de escritura contra Apps Script real). |
| `despliegue/` | `nginx-capri.helgen.online.conf` + `nginx-capri.sh` (certificado, aplicar, probar, deshacer), `revisar-servidor.sh`, `preparar-servidor.sh`, `actualizar.sh`. |
| `pruebas/` | Unidades, escritura (tabla de paridad), puentes del incremento 7, adaptadores de Google con HTTP simulado, identidad, paridad, comportamiento, sombra; `medir.js`. |

## 3. El problema síncrono y la estrategia elegida

`Code.js` es síncrono (`SpreadsheetApp`, `DriveApp`, `UrlFetchApp.fetch`, `MailApp`, `LockService` bloquean); las API de
Google en Node son asíncronas. Opciones evaluadas con el prototipo:

### 3.1 (a) Síncrono sobre asíncrono, escribiendo en cada llamada
`Code.js` en un trabajador; cada llamada a Google se hace en el principal y el trabajador espera con `Atomics.wait`. Las
lecturas salen del espejo; cada `setValue`/`appendRow` es una llamada a Sheets. Funciona sin tocar `Code.js`, pero cada
escritura paga el viaje a Google: un guardado normal tiene de 6 a 9 operaciones de hoja, y la primera vez que se crea
un área (libro de compras con sus pestañas) más de 100.

### 3.2 (b) Memoria + juntar y mandar después, sin bloquear nunca
Todo a memoria y al final se manda. No se puede sin reescribir `Code.js`: en cada guardado `Code.js` **usa en la línea
siguiente** resultados que solo Google da. Contados en el escenario (columna "bloqueantes" abajo): `createFile` y
`createFolder` (el id y la liga van a la fila y a la respuesta), `privado_()` (lee el código HTTP de la API de permisos y
lanza error si no es 200), `getAs('application/pdf')` (los bytes se regresan en base64 en `solicitudCotizacion`), los
avisos al centro de mando (el código decide "Enviado" o "Rechazado"), la API de Claude (sugerencias SAT) y el correo
(el resultado va a la bitácora "Correos"). Los ids de Drive se podrían pedir por adelantado (`files.generateIds`), pero
los códigos HTTP y los bytes no.

### 3.3 (c) La elegida: memoria primero + diario confirmado al soltar el candado + puente síncrono
Lo mejor de las dos: lo que se puede juntar (hojas) se junta, y lo que `Code.js` necesita en el momento se hace síncrono
con el puente de (a). Las escrituras a Sheets se confirman en los puntos donde Apps Script garantiza que otros ya las ven:
al soltar el candado (y al tomarlo, y al terminar la petición, para lo escrito fuera del candado). Resultado: **una
`batchUpdate` por libro por transacción**, atómica, que además regresa lo que Sheets guardó.

### 3.4 Evidencia (`node --expose-gc pruebas/medir.js`)
Mismo escenario con Google simulado. Latencias **supuestas** por tipo de llamada (p50 típicas desde un servidor en México;
la corrida de sombra las reemplaza por las reales): Sheets leer 450 ms, escribir 350, crear 600; Drive leer 150, escribir
300, subir 500, versión 120, permisos 150; HTTP 300; Gmail 400; PDF 450.

| Llamada | (a) escribir en cada llamada | (c) al soltar el candado | Operaciones de hoja | `batchUpdate` (a / c) | Bloqueantes que (b) no podría diferir |
|---|---:|---:|---:|---:|---|
| primer bootstrap (migraciones de Config, pestañas) | 18.4 s | 2.1 s | 49 | 49 / 2 | 1 HTTP |
| primera requisición (crea el área de compras) | 42.4 s | 6.5 s | 104 | 107 / 3 | 11 Drive, 13 HTTP, 2 correos |
| autorizar requisición (emite la OC con PDF) | 5.6 s | **2.8 s** | 9 | 11 / 2 | 4 Drive, 5 HTTP, 1 PDF, 2 correos |
| registrar pago a proveedor (con comprobante) | 4.2 s | **2.3 s** | 6 | 8 / 2 | 5 Drive, 6 HTTP, 2 correos |
| "Recibí el material" (2 fotos) | 6.2 s | **3.6 s** | 8 | 9 / 2 | 7 Drive, 9 HTTP, 2 correos |
| total del escenario (31 llamadas) | 95.4 s | 22.5 s | | | |

- **Lecturas mientras se guarda** (3 requisiciones a la vez, que terminan a los 4.5, 4.5 y 6.7 s): 978 pares de lecturas
  en paralelo, **p50 2 ms, p95 5 ms, máx. 20 ms** (en el proceso; sin la red del navegador al servidor).
- **Sin red** (backend memoria, `pruebas/paridad.test.js`): 1–35 ms por llamada por HTTP; el arnés directo 0.2–8 ms. El
  servidor agrega 2–20 ms (HTTP, trabajador, puente, espejo, confirmación). Cargar `Code.js` en un trabajador: 15–26 ms.
- **Dónde se va el tiempo de un guardado** en (c): 2 `batchUpdate` (≈0.7 s), las revisiones de permisos de `privado_`
  sobre carpetas que ya son privadas (área → año → proyecto en cada guardado con archivo, 3–4 × 150 ms) y los correos
  (2 × 400 ms). Dos ajustes posibles, **no hechos** para no cambiar comportamiento: recordar 5 min que una carpeta ya está
  restringida (−0.45 s; `privado_` hoy repara de inmediato si alguien vuelve a compartir) y mandar los correos después de
  contestar (−0.8 s; la bitácora "Correos" diría "Enviado" antes de saberlo). Se deciden con los números reales de la sombra.

**Decisión: (c).** (a) es 2–7× más lenta en cada guardado y llega a 18–42 s en las migraciones; (b) obligaría a
reescribir `Code.js` en todos los puntos con archivos, permisos, PDF y avisos.

## 4. Cada servicio de Apps Script y su reemplazo

| Apps Script | En el servidor | Notas de comportamiento |
|---|---|---|
| `SpreadsheetApp` (`openById`, `create`, `flush`, `newDataValidation`, `RecalculationInterval`) · `Spreadsheet` · `Sheet` (`deleteRow(s)`, `getDataRange`…) · `Range` (`getNumberFormat`…) · `TextFinder` · `Protection` | `fachada/hojas.js` sobre el espejo local; escrituras al diario; `backends/google/hojas.js` | Leer: memoria. Más de 50 000 caracteres en una celda lanza el error de Apps Script y no escribe nada. `getValues` da `''`, número, texto, booleano o `Date` (un número con formato de fecha/hora en Sheets se vuelve `Date`, como en Apps Script). `getDisplayValues`: el texto que manda Sheets. `getFormulas`: la fórmula; su valor es el último que calculó Sheets. `setValues` revisa dimensiones (mismos mensajes que Apps Script). `setValue` en un rango llena todo el rango. `flush()` no hace nada: confirmar al soltar el candado da la misma garantía con menos viajes. `create()` crea el libro en el momento (es como lo usa `Code.js`). |
| Texto que se escribe | `espejo/entrada.js` (§4.4) | Como Apps Script (USER_ENTERED): número, fecha, hora, booleano, fórmula o texto según el locale del libro y el formato de la celda; apóstrofo = texto. **Los 49 casos se MIDIERON contra Apps Script real el 29/10/2026** y 10 estaban mal: en una celda "@" **nada** se convierte (tampoco la fecha ISO) salvo `=`; un `+` o `-` al inicio no hace fórmula ni número (`+52 442 644 5391`, `-abc`, `+5` quedan texto); más de 15 cifras significativas queda texto (una CLABE de 18 dígitos ya no se guarda como un número con las cifras cambiadas); solo `TRUE`/`FALSE` en inglés; sin am/pm; y un número escrito como texto en una celda de fecha la deja en formato automático. `pruebas/casos-escritura.js` marca cada caso como "medido": **no cambiar una regla sin volver a medir**. Riesgo R1 cerrado. |
| `Date` que se escribe | Número de serie en la zona del libro + formato `yyyy-mm-dd hh:mm:ss` solo si la celda no tenía ya formato de fecha | Así la columna "Fecha" de Cotizaciones (`dd/MM/yyyy HH:mm`) conserva su formato. |
| `DriveApp` · `Folder` · `File` · iteradores | `fachada/drive.js` → `nucleo/servicios.js` (memoria de 60 s para búsquedas por nombre) → Drive API v3 | Mismas ligas que Apps Script (`…/file/d/ID/view?usp=drivesdk`, `…/drive/folders/ID`, `docs.google.com/spreadsheets/d/ID/edit`). `getFoldersByName` incluye los de la Papelera (Code.js los filtra con `isTrashed`). `setSharing` lanza "Access denied: DriveApp." como hoy en helgen.tech (`Code.js` usa `privado_`). |
| `LockService.getScriptLock` | `fachada/transaccion.js` + `nucleo/candado.js` | Uno para todo el servicio, en orden de llegada, reentrante dentro de una petición. `tryLock(ms)` espera hasta `ms`; `waitLock` lanza "Lock timeout…". Al soltar: confirmación (§5). Si `Code.js` no lo suelta, se suelta al terminar la petición (como Apps Script). |
| `CacheService.getScriptCache` | `nucleo/almacen.js` (memoria del principal) | Mismos límites (clave 250, valor 100 KB, 6 h). Dentro del candado lo escrito espera a la confirmación (si Sheets falla, la clave de idempotencia no queda). Se guarda en disco cada 30 s y al apagar: un reinicio no olvida los dobles clics ni los bloqueos de códigos. |
| `PropertiesService.getScriptProperties` | `nucleo/almacen.js` → `/var/lib/capri/propiedades.json` (600) | Igual que caché: dentro del candado se aplica con la confirmación (un `CONSECUTIVO_*` no avanza si la fila no llegó). Cada cambio se escribe a disco (temporal + `fsync` + renombrar) antes de contestar. §9. |
| `UrlFetchApp.fetch` | `fachada/servicios.js` → `nucleo/servicios.js` (`crearSalida`) | Tres caminos: `oauth2.googleapis.com/tokeninfo` → verificación local (§6); `*.googleapis.com` con el token de `ScriptApp.getOAuthToken()` → la credencial del servidor (`privado_`); lo demás (centro de mando, API de Claude) → red. Respeta `muteHttpExceptions` (mismo mensaje de error), `followRedirects`, `payload` texto/bytes/formulario, `getContent()` con bytes con signo. |
| `MailApp.sendEmail` / `getRemainingDailyQuota` | Gmail API `users.messages.send` como facilities@ (`backends/google/correo.js`) | MIME multipart (texto + HTML), nombre "CAPRI Helgen", `Reply-To`, encabezados UTF-8, sin saltos de línea inyectables. Cuota: 1,500 destinatarios por día (como MailApp), contada por el servicio en `estado.json`. |
| `Utilities` | `fachada/servicios.js` | `formatDate` como `SimpleDateFormat` con zona; `newBlob`; base64 (web-safe con relleno, como Apps Script); `computeDigest`/`computeHmac*` con bytes con signo; `getUuid`; `sleep` (bloquea solo al trabajador); `parseCsv`; **`unzip`** (incremento 7: carpetas incluidas, bytes con signo, "stored" y "deflate", CRC; tope de 60 MB inflados por llamada y cada archivo inflado con tope = su tamaño declarado, así un ZIP bomba no tumba el proceso; tipo MIME por extensión). |
| `Blob.getAs('application/pdf')` | Chromium sin interfaz con `puppeteer-core` (`MotorPdf`) | §4.1. |
| `Session` | `getActiveUser()` vacío (como `ANYONE_ANONYMOUS`; el usuario sale del token); `getEffectiveUser()` = facilities@ | |
| `ScriptApp` (`getOAuthToken`, `newTrigger`, `getProjectTriggers`, `deleteTrigger`) | Token marcador (nunca el real dentro de `Code.js`); activadores en `/var/lib/capri/estado.json`, corridos por el servicio | `cadaQuinceMinutos` → un temporizador del servicio: viene declarado en la configuración (`activadoresFijos`) y corre cada 15 min como un trabajo más (límite 5 min; si la anterior sigue, se salta). `instalarActivadorPortal()` lo ve como suyo y no lo duplica. El recordatorio semanal del incremento 7 vive dentro de `cadaQuinceMinutos`: le basta que corra (comprobado en `pruebas/puentes.test.js`) y que las propiedades persistan; el ciclo de 15 min cuenta desde el arranque del contenedor. Las funciones del editor (`prepararCapri`, `asignarClavesProyectos`…) se corren **dentro del contenedor**: `docker compose exec capri node herramientas/admin.js correr <función>` (por nginx o desde el servidor `/admin/correr` no existe). |
| `ContentService` | `createTextOutput` / `setMimeType` | `doPost` regresa lo mismo; el servidor manda su texto. |
| `HtmlService` | No existe (lanza error) | `Code.js` no lo usa (la interfaz vive en Cloudflare). |
| `console` / `Logger` | Líneas JSON con el trabajo y la función | §4.3. |

### 4.1 PDF con Chromium
`MotorPdf` abre **un** Chromium sin interfaz (`chrome-headless-shell` 156.0.8078.47 en `/opt/capri/chrome` dentro de la
imagen: la versión exacta que pide puppeteer-core 25.16.0, revisada por una prueba; se abre en modo `headless: 'shell'`) y una página por PDF (máx. 2 a
la vez), con **JavaScript apagado y sin red** (solo imágenes `data:`; todo lo demás se aborta), `setContent(html)` y
`page.pdf({format: 'Letter', printBackground: false, margin 10 mm})`. `printBackground: false` imita al conversor de Google
(no imprime fondos, §6.3), así el HTML de hoy sale igual. Si Chromium se cae, se vuelve a abrir. Fuentes: `fonts-liberation`
(Liberation Sans mide igual que Arial). **No se pudo medir aquí** (la red del entorno de pruebas bloquea la descarga de
Chromium): está probado con un navegador falso que revisa todo lo anterior; tiempo esperado 0.3–0.8 s por PDF con el
navegador ya abierto (hoy ~15 s en Apps Script). Riesgo R2.

### 4.2 Correo
Como facilities@ con la API de Gmail (mismo remitente que hoy). Límites de Gmail para Workspace: 2,000 mensajes y 10,000
destinatarios por día por cuenta; el servicio conserva el límite de MailApp (1,500 destinatarios/día) para que
`Code.js` siga reservando cuota para los códigos de entrada. Recomendado: un **token aparte solo para correo** (§7), así un
cambio de contraseña de facilities@ apaga los correos pero no CAPRI.

### 4.3 Registro y tiempos
Una línea JSON por llamada en la salida estándar (journald):
`{"t", "nivel", "texto":"llamada", "funcion", "usuario" (correo del token, sin verificar, solo para soporte), "ok", "codigo",
"ms" (total), "msCola", "msTrabajo", "cpuMs", "rpc": {"hojas":{n,ms}, "drive":…, "url":…, "correo":…, "pdf":…, "tx":…},
"confirmaciones", "operaciones", "entrada", "salida" (bytes), "trabajador"}`; además lo que escribe `Code.js` con
`console.warn/log` (con la función y el trabajo), errores de confirmación, recargas por edición a mano, "deriva" de la
reconciliación y cortes por tiempo. **Nunca** cuerpos, tokens, archivos ni montos.
Docker las guarda (json-file, 5 × 10 MB). Consultas: `sudo docker logs capri 2>&1 | jq -c 'select(.texto=="llamada") | {funcion, ms, rpc}'`; lentas:
`… | jq -c 'select(.texto=="llamada" and .ms > 1000)'`. Opcional: mandarlas a Grafana Loki con Vector como las de htracker.
`sudo docker compose exec capri node herramientas/admin.js salud` (solo dentro del contenedor; desde fuera y por nginx solo
`{"ok":true}`): trabajadores, cola, candado, libros cargados con su locale, zona y antigüedad, métricas de
confirmaciones/fallas/recargas, cuota de correo, memoria. El HEALTHCHECK de la imagen usa lo mismo.

### 4.4 Escritura como Apps Script (USER_ENTERED)
Apps Script escribe con `setValue`/`setValues`/`appendRow` como si alguien tecleara en la celda: Sheets convierte el texto
en número, fecha, hora, booleano o fórmula según el **locale del libro** y el **formato de la celda**. `spreadsheets.batchUpdate`
(la llamada atómica del diario) no tiene `valueInputOption` —solo `values.update`/`values.batchUpdate`, que costarían otra
llamada por libro y la atomicidad entre estructura y valores—, así que la conversión se hace en el trabajador al escribir
(`espejo/entrada.js`): el código lee en la línea siguiente lo ya convertido (como en Apps Script) y el diario manda cada
celda tipada (`numberValue`, `boolValue`, `formulaValue`, `stringValue`) con el formato que Sheets le pondría (fecha en una
celda sin formato de fecha; `%`, `$`, miles, exponente). Cada operación anota `entrada: 'USER_ENTERED'` (setValue(s),
appendRow) o `'RAW'` (setFormula(s), clearContent).

Reglas en orden: (1) lo que no es texto pasa tal cual (un número en una celda de fecha se lee como Date); (2) apóstrofo =
texto literal (`textoCelda`, `textoFecha_`); (3) celda en texto plano "@": queda texto, **salvo** la fecha ISO
`aaaa-mm-dd[ hh:mm[:ss]]`, que Sheets sí convierte (observado en producción, CLAUDE.md §6.2); (4) `=` = fórmula; (5)
booleano, número (separadores del locale, signo, `$`, `%`, miles bien agrupados, exponente, 15 cifras), fecha
(`aaaa-mm-dd`, `aaaa/mm/dd`, `d/m/aaaa` o `m/d/aaaa` según el locale, año de 2 cifras, `d/m` sin año), fecha y hora, hora
(`h:mm[:ss][ am/pm]`); (6) `+…`/`-…` que no es número = fórmula `=+…` (así `+52 442 644 5391` queda `#ERROR!`, regla 7);
(7) lo demás, texto. El espejo sabe el locale de cada libro (`properties.locale`) y qué celdas son texto plano: las que
vinieron de Sheets (por tramos de filas por columna) y las que Code.js formateó con `setNumberFormat('@')`; más abajo de lo
cargado vale el formato de la última fila que vino.

La tabla `pruebas/casos-escritura.js` (49 casos) dice de dónde sale cada resultado: documentación de la API de Sheets
(USER_ENTERED), CLAUDE.md §6.2 y regla 7, `migrarConfig_`, la ayuda de "texto sin formato", o **supuesto** (14 casos:
`VERDADERO`, `+5`, `3/4` sin año, años de 2 cifras, `=…` y `d/m/aaaa` en "@"…). `herramientas/paridad-escritura.js codigo`
genera una función temporal de Apps Script con los mismos casos; `comparar` dice cuáles difieren del servidor
(`servidor-comandos.md` E3). Fuera de la tabla (quedan texto en el servidor; Sheets podría convertirlos): meses con nombre
("20 oct 2026"), horas ≥ 24 (duraciones), números entre paréntesis, monedas distintas de `$`.

## 5. Consistencia, concurrencia y fallas

**Copias.** El principal tiene la **copia canónica** de cada libro (lo que hay en Sheets). Cada trabajador tiene su copia
local. Cada cambio de la canónica lleva una **revisión**; a los trabajadores les llega un **parche** con solo las hojas que
cambiaron (no el libro entero: con un año de datos, copiar el libro de compras cuesta 69 ms y un parche de 3 hojas 22 ms)
y dice sobre qué revisión se aplica. Lo viejo nunca pisa lo nuevo; un parche que no corresponde a la copia local la
borra y la siguiente lectura trae la canónica (`modelo.aplicarLibroOParche`, probado).

**Lecturas en paralelo.** 3 trabajadores; siempre queda uno libre para lecturas aunque haya escrituras esperando el
candado. Las copias nuevas se aplican al **empezar** cada petición y al **tomar el candado**: a media petición los datos no
cambian (una lectura nunca ve un guardado a medias de otro; en Apps Script sí podía pasar).

**Escrituras en serie.** Un solo candado (el de hoy). Además de `Code.js`, lo usan: la confirmación de lo escrito fuera
del candado (migraciones de encabezados, la bitácora "Correos") y el reemplazo de la copia canónica cuando alguien editó
a mano. Así **la copia canónica solo cambia con el candado tomado**, y quien lo tiene ve exactamente lo que está en Sheets
(menos ediciones a mano de los últimos 15 s, ver abajo).

**Atomicidad.**
- Por libro: una `batchUpdate` es todo o nada.
- Entre libros (p. ej. compras + la bitácora de Administración en una misma operación): se confirman en orden; si el
  segundo falla, el primero ya quedó (igual que hoy en Apps Script, que además podía quedar a medias dentro de un libro).
  La respuesta lo dice: "Lo de 1 libro(s) anterior(es) sí se guardó. Revisa antes de repetir."
- Drive va antes que la fila (como hoy): si Sheets falla, el archivo subido queda huérfano (probado; igual que hoy).
- Propiedades y caché escritas dentro del candado **solo se aplican si todos los libros llegaron**: el folio no se gasta y
  la clave de idempotencia no queda, así repetir con el mismo `idSolicitud` funciona (probado).

**Falla al escribir en Sheets.** El principal relee ese libro de Google, el trabajador tira su copia supuesta y
`releaseLock()` lanza: `{ok:false, codigo:"GUARDAR", error:"No se pudo guardar en Google Sheets ("Compras"): UNAVAILABLE
… No se guardó nada de esta operación. Revisa antes de repetir."}`. Solo se reintenta un 429 (cuota: Google no lo
procesó); un 5xx o un corte pudieron haberse aplicado y no se repiten a ciegas. **Nunca se contesta "ok" sin
confirmación.**

**Corte por tiempo.** 120 s por petición (5 min el activador). Se termina el trabajador (se crea otro), se espera a que el
principal termine lo que estuviera confirmando por él, se quitan de la cola sus peticiones de candado y se suelta el
suyo: `{ok:false, codigo:"TIEMPO", error:"…Lo que no alcanzó a guardarse no se guardó; revisa antes de repetir."}`. Lo
que ya se estaba confirmando termina y la idempotencia lo devuelve al repetir (probado).

**Ediciones a mano** (Estado del proyecto, precios, permisos…).
1. **Sondeo cada 60 s**: versión de cada libro en Drive; si cambió, se relee el libro (3 llamadas: pestañas, extensión con
   datos, cuadrícula de esa zona), se reemplaza la copia canónica con el candado, se suben las versiones `VER_*` de sus
   colecciones y se borran las marcas `R_*` del caché: la consulta de los navegadores (cada 20 s) lo trae. **≤ 60 + 20 s.**
2. **Al entregar el candado**, si pasaron más de 15 s del último sondeo, se revisan las versiones (≈120 ms): quien guarda
   ve lo editado a mano (probado: un folio agregado a mano se cuenta en el siguiente).
3. **Reconciliación cada 10 min**: se releen todos y se reemplazan si difieren (una fórmula que se recalculó sin que nadie
   editara, como `GOOGLEFINANCE` del tipo de cambio, no cambia la versión de Drive). Queda en el registro como "deriva".

**Lectura de regreso.** La `batchUpdate` regresa las filas tocadas como quedaron (fechas, fórmulas y su valor, texto
visible); eso reemplaza lo que el trabajador supuso. Si una hoja cambió de estructura (fila borrada, insertada, hoja
nueva), se relee completa hasta su última fila con datos.

**Apagado.** `docker compose stop/restart` (o el cambio de imagen de `actualizar.sh`) → `tini` le pasa SIGTERM al servicio:
deja de aceptar, espera hasta 30 s a lo que está en curso, guarda el caché (Docker espera 45 s antes de matar). nginx
contesta mientras tanto `{ok:false, codigo:"REINICIO", "CAPRI se está actualizando…"}`.

**Estado global de `Code.js`.** En Apps Script cada ejecución empieza de cero; aquí el contexto se reutiliza. Revisado:
las únicas variables globales que cambian (`VENDEDOR_`, `VERSIONES_`, `SIN_CACHE_`, `MEMO_`) se limpian al empezar y al
terminar `doPost` y `cadaQuinceMinutos`. **Regla nueva para `Code.js`:** ninguna variable global nueva que guarde algo
entre peticiones sin limpiarla ahí.

## 6. Sesión: verificación local del token de Google y sesiones CAPRI

- `Code.js` sigue llamando `UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=…')`. El servidor
  intercepta esa dirección y contesta lo mismo que tokeninfo después de verificar **aquí**: firma RS256 con las llaves de
  Google (`https://www.googleapis.com/oauth2/v3/certs` con `jose`: en memoria hasta 6 h; si llega un token firmado con una
  llave nueva se vuelven a pedir, máx. una vez cada 30 s), emisor
  (`accounts.google.com` o `https://accounts.google.com`), audiencia = el Client ID de `Code.js`, vencimiento (30 s de
  margen) y solo RS256 (probado contra HS256 con la llave pública, otra llave, otra audiencia, carga alterada, vencido).
  Después `validarClaimsToken` de `Code.js` revisa otra vez `aud`, `iss`, `exp`, `hd` y `email_verified` sin cambios
  (probado de punta a punta). El resultado sigue en caché 10 min como hoy. Ya no hay una llamada a Google por sesión.
- Sesiones CAPRI de @helgen.services (`capri.…`): las verifica `Code.js` con `SESION_SECRETO`, que viaja con las Script
  Properties (§9). Mismo secreto = las sesiones abiertas siguen valiendo después del cambio.
- CORS: solo los orígenes de `origenes` en la configuración (en producción, solo la interfaz de Cloudflare). nginx además
  rechaza (403 `ORIGEN`) una llamada que traiga `Origin` de otro sitio; sin `Origin` pasa (curl, la herramienta de sombra).
  La interfaz manda POST `text/plain` (petición simple: el navegador no hace la consulta previa OPTIONS). Para el ensayo con
  la interfaz local, agregar `http://127.0.0.1:8788` en `origenes` y en los dos `map` de nginx, y quitarlo después.

## 7. Identidad de Google del servidor

Hoy la API corre como facilities@ (`USER_DEPLOYING`): lee y escribe los libros, crea archivos y manda correo como esa
cuenta. El servidor hace lo mismo con **un permiso OAuth de facilities@ dado a una app Interna** de la organización
helgen.tech (decidido el 29/10). **Nunca una llave de cuenta de servicio**: una cuenta de servicio con delegación en todo el
dominio sería una llave maestra (podría leer el Drive y mandar correo como cualquier persona de helgen.tech) guardada en un
servidor compartido con git y Drogheda. (El código aún sabe leer ese tipo de credencial; no se usa.)

| | Token de facilities@ (app OAuth Interna) |
|---|---|
| Qué puede hacer | Lo que ya puede facilities@: exactamente lo que hoy hace la API de Apps Script |
| Alcances | `spreadsheets` + `drive` (un token) y `gmail.send` (otro token) |
| Vencimiento | No vence por tiempo (app Interna). Google lo revoca si cambia la contraseña de facilities@ (**solo** el que tiene Gmail), si alguien quita el acceso o tras 6 meses sin uso |
| Si se revoca | `salud` y el registro muestran `invalid_grant`; se repite la autorización de ese token y se reinicia (minutos) |

**Dos tokens**: `/srv/capri/config/google-facilities.json` (Sheets + Drive) y `/srv/capri/config/google-facilities-correo.json`
(solo `gmail.send`). Un cambio de contraseña de facilities@ apaga los correos, no CAPRI.

**Pasos** (proyecto `capri-servidor` en la organización, tres API, consentimiento Interno, alcances, cliente "App de
escritorio", app de confianza en Controles de API, y la autorización como facilities@ con `herramientas/autorizar.js`
dentro del contenedor por un túnel SSH): [`servidor-google-paso-a-paso.md`](servidor-google-paso-a-paso.md), pasos 1–7.
La herramienta usa PKCE, revisa que la cuenta sea facilities@ y que se aceptaron todos los alcances, y guarda el token con
permisos 600. Se usa un proyecto de Cloud nuevo (no el del Client ID de la interfaz, `884526916417`): así el inicio de
sesión de la interfaz no se toca.

## 8. Secretos

Todo fuera del repositorio y de la imagen (el contexto de construcción es una lista blanca, `/.dockerignore`). En el
servidor, dueño `capri` (UID/GID 10001 = el usuario del contenedor), carpetas 700, archivos 600:

| Qué | Dónde (servidor → contenedor) | Lo escribe |
|---|---|---|
| Configuración (sin secretos) | `/srv/capri/config/capri.json` → `/etc/capri/` (solo lectura) | `preparar-servidor.sh`; Gibran |
| Tokens de Google (§7) | `/srv/capri/config/google-facilities.json`, `…-correo.json` → `/etc/capri/` (solo lectura) | `autorizar.js` |
| Script Properties (incluyen `SESION_SECRETO`, `PORTAL_SECRETO`, `ANTHROPIC_API_KEY`) | `/srv/capri/datos/propiedades.json` → `/var/lib/capri/` | `propiedades.js` y el servicio |
| Caché (claves de idempotencia, huellas de códigos de entrada), activadores, cuota de correo | `/srv/capri/datos/cache.json`, `estado.json` | el servicio |

`Code.js` nunca ve el token real de Google (ve un marcador; el principal pone la credencial al salir a `googleapis.com`).
El registro nunca lleva secretos. Ninguna herramienta imprime el valor de un secreto (`propiedades.js comparar` solo dice
"distinto"). Rotar `PORTAL_SECRETO`: cambiarlo en el archivo (con el servicio detenido) y en `COTIZADOR_SECRETO` del centro
de mando a la vez.

## 9. Script Properties → archivo JSON

Recomendado **archivo** (no una hoja: una hoja expondría los secretos a sus editores y costaría llamadas). `Code.js` las
lee igual (`PropertiesService`). Se copian dos veces: al empezar la sombra y la noche del cambio (con `API_MUDADA` ya
puesta, §12). Como facilities@, en el editor de Apps Script, con una función **temporal que no se guarda en el
repositorio** (archivo `temporal` que se borra al terminar):

```javascript
function exportarPropiedadesTemporal() {
  const p = PropertiesService.getScriptProperties().getProperties();
  const f = DriveApp.createFile('capri-propiedades.json', JSON.stringify(p), 'application/json');
  privado_(f); // restringido (§6.11)
  console.log('ID para el servidor: ' + f.getId());
}
```

En el servidor, con el servicio detenido: `docker compose run --rm capri node herramientas/propiedades.js importar-drive
<ID> /var/lib/capri/propiedades.json --borrar`. Baja el archivo de Drive **como facilities@** (con el token del servidor),
lo valida, quita `API_MUDADA`, lo escribe con permisos 600, avisa qué propiedad necesaria falta y lo **elimina de Drive
definitivamente** (sin Papelera): los secretos no pasan por ninguna computadora ni por el chat. El servicio **no arranca**
si encuentra `API_MUDADA`. Notas: los `CONSECUTIVO_*` son seguros aunque estén atrasados (el folio es el mayor entre el
contador y la hoja, §6.1); los `VER_*` del servidor pueden ser distintos de los del navegador sin problema (la consulta
manda todo de nuevo); `SESION_DESDE_*` (sesiones CAPRI cerradas) hay que copiarlos de regreso si se regresa a Apps Script
(`servidor-comandos.md` G1).

## 10. Despliegue en helgensrvr (Docker detrás de nginx)

Comandos exactos y en orden: [`servidor-comandos.md`](servidor-comandos.md). Aquí, qué hace cada pieza y por qué.

**10.1 Revisión** (`despliegue/revisar-servidor.sh`, solo lee): arquitectura, Docker y compose, nginx/certbot y los
archivos de Let's Encrypt, puertos, firewall, DNS, salida a Google, Docker Hub, npm, Chrome for Testing y Debian, el centro
de mando por su nombre, UID 10001 libre.

**10.2 La imagen y el contenedor.** El servidor no tiene Node: todo corre en la imagen.
- `servidor/Dockerfile` (contexto = raíz del repositorio, lista blanca en `/.dockerignore`): `node:22.23.4-bookworm-slim`
  (la versión con la que pasan las pruebas; LTS hasta abril de 2027), `npm ci --omit=dev`, Chrome for Testing
  `chrome-headless-shell` 156.0.8078.47 bajado con el `@puppeteer/browsers` de `package-lock` (en arm64, el chromium de
  Debian), librerías de Chromium, `fonts-liberation` y `tzdata`; revisa con `ldd` que no falte ninguna librería; usuario
  10001 sin privilegios; `HEALTHCHECK` = `herramientas/admin.js salud` (sano = los trabajadores cargaron Code.js). Etapa
  `pruebas`: la misma imagen + `tests/arnes.js` + `servidor/pruebas`, para correr las pruebas dentro de la imagen.
- `servidor/docker-compose.yml`: publica **solo `127.0.0.1:8090`**; `restart: unless-stopped` (Docker la levanta con el
  servidor: no hace falta systemd y se quitó `capri.service`); `init: true` (tini: recoge los procesos de Chromium y pasa
  SIGTERM); raíz de solo lectura con `/tmp` en memoria; sin capacidades y `no-new-privileges`; 1200 MB de memoria; 45 s
  para apagar; `/srv/capri/config` en solo lectura y `/srv/capri/datos`; bitácora json-file rotada (5 × 10 MB); y
  `drogheda.helgen.online` apuntando a la puerta del servidor (`extra_hosts: host-gateway`): los avisos al centro de mando
  van por el nginx de drogheda con su certificado, sin depender de que el ruteador regrese el tráfico a su propia IP
  pública.
- Dentro del contenedor el servicio escucha en `0.0.0.0` (`CAPRI_HOST`); el archivo de configuración se queda con
  `127.0.0.1`. Como nginx y el servidor llegan por la red de Docker, para el servicio no son "locales": `/salud` les da solo
  `{"ok":true}` y `/admin/correr` no existe; el detalle y "Ejecutar" solo con `docker compose exec` (requiere sudo/docker).

**10.3 Una sola vez** (`despliegue/preparar-servidor.sh`, con sudo, idempotente): usuario y grupo `capri` 10001,
`/srv/capri/{config,datos}` 700, `capri.json` desde el ejemplo **en solo lectura** (la primera corrida es la sombra) y la
imagen construida con la etiqueta del commit (`servidor/.env`: `CAPRI_VERSION`, `CAPRI_CONFIG_DIR`, `CAPRI_DATOS_DIR`). No
arranca nada ni toca nginx.

**nginx + certbot** (`despliegue/nginx-capri.sh`, con sudo; mismo estilo que `cambiar-entrada.sh` de drogheda: respaldo,
`nginx -t`, pruebas y regreso automático):
1. `certificado`: instala solo el bloque del puerto 80 (reto ACME en `/var/www/letsencrypt` + redirección a https) y corre
   `certbot certonly --webroot -d capri.helgen.online --deploy-hook 'systemctl reload nginx'`. **Por qué webroot y no
   `certbot --nginx`** (como drogheda): así certbot nunca edita el archivo de nginx de capri (el del repositorio es la fuente
   completa) y la renovación no depende de cómo certbot entiende ese archivo. Misma renovación automática (`certbot.timer`).
2. `aplicar`: el archivo completo — 80 (reto + redirección) y 443 → `127.0.0.1:8090` con los `options-ssl-nginx.conf` y
   `ssl-dhparams.pem` que ya usa drogheda; CORS solo para `https://cotizador-helgen.cotizador-helgen.workers.dev` (otro
   `Origin` → 403 JSON; el `map` va con expresión regular porque esa llave no cabe en `map_hash_bucket_size` y `nginx -t`
   fallaba); 50 MB por llamada (un archivo de 10 MB en base64 son ~13.4 MB y una recepción trae varias fotos; igual que el
   límite del servicio) con 413 → JSON `GRANDE`; 180 s de espera (el servicio corta a los 120 s; un PDF aquí tarda 0.3–0.8 s,
   en Apps Script ~15 s); límite por IP como drogheda (10 llamadas/s, ráfaga 80, 429 → JSON `LIMITE`; la oficina sale por
   una IP); 502/503/504 → JSON `REINICIO`; HSTS; `/salud` limitado; lo demás 404. Zonas y variables con prefijo `capri`.
3. Antes y después compara la huella de `nginx.conf` y de los demás sitios habilitados: si cambiara alguno (no debe),
   regresa. `probar` corre las pruebas sin cambiar nada; `deshacer` quita el sitio de capri.
Probado aquí con nginx 1.24 junto con una copia del archivo de drogheda: `nginx -t` limpio, redirección, reto ACME, CORS,
origen ajeno, 413, 429, reinicio, `/admin/correr` oculto.

**10.4 Actualizar** (`despliegue/actualizar.sh [rama]`, como dueño del repositorio, fuera de horario): `git fetch` →
construye la etapa `pruebas` y corre **las pruebas del servidor dentro de la imagen nueva** (sin red, raíz de solo
lectura; ~20 s) → construye la imagen final con la etiqueta del commit → cambia el contenedor → espera el `HEALTHCHECK`.
Si algo falla antes del cambio, no se toca nada; si la nueva no queda sana, regresa sola a la anterior, borra la que falló
y deja el repositorio donde estaba. `--regresar [etiqueta]` (a la construida justo antes de la que corre) y `--estado`. Se
quedan las 5 imágenes más nuevas. Se corre desde una copia temporal de sí mismo (el `git checkout` lo cambiaría a media
lectura). Probado aquí de punta a punta (cambio sano, arranque roto con regreso solo, `--regresar`). Un cambio de
`Code.js` ya no se publica con `clasp`: es esto (§12.4 para Apps Script).

**10.5 Coexistencia con el centro de mando.** CAPRI y `drogheda.helgen.online` quedan en la misma máquina sin compartir
nada (el contenedor no ve `127.0.0.1:8081`). `PORTAL_URL` sigue siendo `https://drogheda.helgen.online`: los avisos llegan
al nginx de drogheda desde la red de Docker (IP 172.x), así que la zona `hbox_cotizador` (pensada para las IP de Google)
los cuenta por esa IP; holgada. La ruta `/api/integracion/` de drogheda debe estar abierta sin sesión (ya lo está en
`hbox-docs/backend/nginx/drogheda.helgen.online.conf`, que instala `cambiar-entrada.sh aplicar`).

## 11. Presupuesto de memoria y CPU

Medido (`pruebas/medir.js`, `/salud`):
- Cada trabajador con `Code.js` cargado: ~9–10 MB de montón de V8 (más ~20–30 MB del hilo); carga en 15–26 ms.
- El espejo con datos de **un año con holgura** (3,000 cotizaciones, 2,000 órdenes de 45 columnas, 2,000 requisiciones con
  8,000 renglones y 10,000 eventos, 5,000 movimientos de inventario, 3,000 correos…; 613,040 celdas): **~32 MB por copia**.
  4 copias (principal + 3 trabajadores) ≈ 130 MB. Hoy los libros son mucho más chicos.
- Un parche después de un guardado: ~22 ms por trabajador a ese tamaño; la huella del libro (109 ms) solo se calcula al
  releer de Google, fuera de las peticiones.
- Chromium: ~150–300 MB mientras hace PDF (un navegador, máx. 2 páginas).
- Llamadas grandes: un cuerpo de 50 MB con fotos en base64 ocupa ~5–8× en memoria mientras se procesa.

| | Normal | Pico |
|---|---:|---:|
| Principal + 3 trabajadores + espejo (un año) | 250–350 MB | 450 MB |
| Chromium | 0 (cerrado) – 150 MB | 300 MB |
| **Total** | **~350 MB** | **~800 MB** |

CPU: cada llamada usa 1–35 ms de CPU; el resto es espera a Google. helgensrvr (64 núcleos, 60 GiB) sobra; el contenedor
se limita a 1.2 GB (`mem_limit` en `docker-compose.yml`) y 512 procesos. La imagen pesa ~400 MB (Node + Chromium + fuentes).

Cuotas de Google (todas las llamadas son de facilities@; [límites de la API de Sheets](https://developers.google.com/sheets/api/limits),
revisados el 29/10/2026): **60 lecturas y 60 escrituras por minuto por usuario por proyecto** (300 por proyecto), máximo
180 s por petición y ≤ 2 MB recomendados por petición. Con el espejo las lecturas casi no gastan (cargar un libro = 3
lecturas; sondeo en Drive; reconciliación: ~15 lecturas cada 10 min) y cada guardado usa 1–3 `batchUpdate`: el techo es
~20–60 guardados por minuto. Un 429 se reintenta con espera. La carga acotada (solo la zona con datos) y la lectura de
regreso de solo las filas tocadas mantienen las peticiones chicas.

## 12. Corrida de sombra, cambio y regreso

Comandos exactos: [`servidor-comandos.md`](servidor-comandos.md) secciones D–G; lo de Google, en
[`servidor-google-paso-a-paso.md`](servidor-google-paso-a-paso.md) pasos 8–13.

### 12.1 Corrida de sombra (solo lectura, con datos reales)
1. Servidor con `"soloLectura": true` (así lo deja `preparar-servidor.sh`) y las propiedades importadas (sin `API_MUDADA`).
   En ese modo: las funciones que escriben (`CAMBIOS_API`) contestan `SOLO_LECTURA`; si una lectura intenta escribir en
   Sheets (migraciones de encabezados), se descarta y queda en el registro ("solo lectura: no se escribió…"); Drive no crea
   nada; no se mandan correos; las llamadas externas (centro de mando, Claude) se bloquean; no corren activadores. Apps
   Script sigue siendo el único que escribe; el servidor ve sus cambios en ≤ 60 s (sondeo).
2. `herramientas/sombra.js` dentro del contenedor con el ID token de leo@ (`localStorage.getItem('cotizadorHelgenSesion')`
   en la pestaña de CAPRI, vale ~1 h; se pasa por una variable de entorno que no queda en el historial). Manda **solo**
   lecturas de una lista fija (21 funciones + detalles de requisiciones y proyectos reales) a los dos, compara las
   respuestas (sin `versiones`, `sesionCapri`, tiempos) y mide cada una. Con `--reintentar`, lo distinto se repite a los 75 s
   (puede ser alguien que guardó en ese minuto). Probado con dos servidores en memoria.
3. Repetir con un usuario de cada rol (compras, cobranza, solo requisiciones, @helgen.services).
4. **Criterio para el cambio:** todas iguales en 2 corridas en días distintos (o cada diferencia explicada), latencias
   reales registradas, la **tabla de escritura confirmada con Apps Script** (`paridad-escritura.js`, §4.4) y un **ensayo con
   escritura** contra copias de los libros (los archivos PRUEBAS de CLAUDE.md §10.5, servidor en modo normal con sus propias
   propiedades, interfaz local apuntando al servidor; las pruebas en el navegador las hace Claude, regla 13) que cubra
   cotización con PDF, requisición → OC → pago → recepción con fotos, cobranza y anular.

### 12.2 El cambio (una noche, ~30 min; un solo escritor)
0. **Antes (días antes):** el `Code.js` publicado en Apps Script debe traer la costura `API_MUDADA` (§13). Desde el
   29/10/2026 esta rama es la misma que `incremento-7` (incrementos 5, 6 y 7 sin publicar): la costura sale publicada con
   ellos, con sus pasos de siempre como facilities@ (CLAUDE.md §9). Sin la propiedad no cambia nada. El servidor corre el
   mismo `Code.js` que Apps Script: nunca cambiar con un servidor que tenga otra versión del código que la publicada.
1. Aviso al equipo; respaldo de los libros (como siempre, §2).
2. **Apps Script deja de escribir:** en Script Properties de `1GsH8Dja…` poner `API_MUDADA = https://capri.helgen.online`.
   Desde ese momento toda llamada (y el activador de 15 min) contesta "CAPRI se cambió a su servidor nuevo. Recarga la
   página…" sin escribir nada.
3. Exportar las propiedades e importarlas en el servidor con el servicio detenido (§9).
4. `/srv/capri/config/capri.json`: `"soloLectura": false`; `docker compose up -d`; `admin.js salud` con los trabajadores
   listos y `activadores: ["cadaQuinceMinutos"]` (viene declarado en `activadoresFijos` de la configuración; en solo lectura
   no corre).
5. Interfaz: `API_URL = 'https://capri.helgen.online/api'` en `web/cotizador/index.html` y
   `CLOUDFLARE_ACCOUNT_ID=badd8bca60b008822a73ca24e983ff43 npx --yes wrangler@4 deploy`.
6. Revisión (Claude in Chrome con la sesión de Leo): entrar, Pendientes, una lectura de cada pestaña, un guardado de prueba
   marcado como prueba (§5 del CLAUDE.md). Revisar el registro (`sudo docker logs -f capri`).

### 12.3 Regreso (si algo sale mal)
1. Servidor en `"soloLectura": true` y `docker compose restart capri` (deja de escribir; un solo escritor).
2. `propiedades.js comparar` contra un archivo vacío lista las `SESION_DESDE_*` (sesiones cerradas; no son secretos):
   copiarlas a Apps Script. `VER_*` y `CONSECUTIVO_*` no hace falta.
3. **Borrar `API_MUDADA`** en Apps Script: vuelve a atender y su activador a correr.
4. Interfaz: `API_URL` de regreso al deployment de Apps Script y `wrangler deploy` (o `wrangler rollback`).
Las claves de idempotencia del servidor no pasan a Apps Script: un doble clic justo en el regreso podría duplicar; hacerlo
sin gente guardando.

### 12.4 Mientras dure la estabilización (2–4 semanas)
Cada cambio de `Code.js` que se publique en el servidor (`actualizar.sh`) también se sube a Apps Script (`clasp push` y
nueva versión con `API_MUDADA` puesta): así el regreso corre el mismo código que entiende las mismas columnas.

## 13. Costuras en Code.js

**Para el servidor: ninguna.** `Code.js` y `Logo.js` se cargan tal cual (la paridad lo prueba). Lo que el servidor
necesita se resuelve afuera: tokeninfo y la API de permisos de Drive se interceptan en `UrlFetchApp`, el token de
`ScriptApp` es un marcador, los activadores se emulan.

**Para el cambio (opcional, recomendada): `API_MUDADA`** — 11 líneas, sin efecto mientras la propiedad no exista:
- `doPost`: si la propiedad tiene valor, contesta `{ok:false, codigo:"MUDADA", error:"CAPRI se cambió a su servidor nuevo.
  Recarga la página…"}` antes de leer el cuerpo (no atiende ni escribe nada).
- `cadaQuinceMinutos`: si la propiedad tiene valor, regresa `{mudada: true}` sin hacer nada.
- `errorMudada_()`.
- Prueba: `tests/mudanza.test.js` (sin propiedad = como siempre; con ella nada se escribe y el activador no llama a nada;
  al borrarla todo sigue). `bash tests/todas.sh` en verde.
Por qué: el activador de Apps Script corre el código guardado (HEAD), no el deployment; sin la costura, apagar Apps Script
exigiría subir otro código (y el regreso, volver a subir `Code.js`, publicar y recrear el activador). Con ella, apagar y
regresar es una propiedad.

Fuera de `servidor/` también cambiaron: `.gitignore` (credenciales y propiedades del servidor), `tests/todas.sh` (corre
las pruebas del servidor si ya se instalaron sus dependencias), `tests/mudanza.test.js` y `/.dockerignore`. La escritura
USER_ENTERED, Docker y los puentes del incremento 7 (29/10) no tocaron `Code.js`.

## 14. Riesgos y desconocidos

| # | Riesgo | Qué tan probable / qué pasa | Qué se hace |
|---|---|---|---|
| R1 | **Texto que parece número o fecha** se guardaba distinto que en Apps Script | **CERRADO el 29/10/2026** con `paridad-escritura.js` contra Apps Script real (corrida de Leo, E3): 10 de los 49 casos salían mal, el peor una CLABE de 18 dígitos guardada como número con las cifras cambiadas. `espejo/entrada.js` corregido, los 49 casos marcados "medido" y la prueba vuelve a dar 49 de 49 | Queda por medir: am/pm junto a una fecha y un número con formato ("15%") escrito en una celda de fecha. Cada E3 nuevo lo revisa |
| R2 | **PDF de Chromium ≠ conversor de Google** (fuentes, márgenes, saltos de página) | Visual; no se pudo probar aquí | Comparar 5–10 PDF reales lado a lado en el ensayo; ajustar margen/formato; `fonts-liberation` |
| R3 | **Los adaptadores de Google se probaron contra respuestas con la forma documentada**, no contra Google | Diferencias de detalle (máscaras de campos, `responseRanges`, `values.batchGet`, `corpora` de Drive) | Primer contacto real = 1–2 días de ajuste (§15) |
| R4 | **La paridad es contra el arnés**, no contra Apps Script real (el arnés no tiene `getParent`, `setFormula`… y el servidor sí, como Apps Script) | La sombra compara contra Apps Script real, pero solo lecturas | Ensayo con escritura en copias antes del cambio |
| R5 | Edición a mano **dentro** de los 1–3 s de un guardado (insertar o borrar filas a mano mientras alguien guarda) | Raro; hoy pasa lo mismo con Apps Script | Revisión de frescura al tomar el candado; no borrar filas a mano en horario |
| R6 | Fórmulas que se recalculan solas (`GOOGLEFINANCE`) se ven hasta 10 min tarde | Tipo de cambio del catálogo | Reconciliación cada 10 min (se puede bajar para el catálogo) |
| R7 | Escritura en dos libros: el segundo falla y el primero ya quedó | Raro (falla de Google a media operación) | Mensaje explícito; las claves de idempotencia no quedan; revisar a mano |
| R8 | Cuota de Sheets por usuario: **60 escrituras/min** (facilities@) | Solo con ráfagas grandes | 1–3 `batchUpdate` por guardado; 429 con reintento |
| R9 | Revocación del token (cambio de contraseña de facilities@) | Se apagan los correos (con token aparte) o todo | Token de correo aparte; `invalid_grant` en el registro; guía paso 11 |
| R10 | Un solo servidor (también git y Drogheda): si se cae, se cae CAPRI | | Regreso a Apps Script en minutos (§12.3) |
| R11 | Reinicios en cada actualización (5–15 s) | Error "se está actualizando" en la interfaz | Actualizar fuera de horario; idempotencia protege los reintentos |
| R12 | Estado global nuevo en `Code.js` que no se limpie | Se mezclaría entre peticiones (en Apps Script no) | Regla del §5; revisión en cada incremento |
| R13 | Chromium sin su sandbox dentro del contenedor (sin capacidades ni espacios de usuario) | Se usa `--no-sandbox` | Páginas sin JavaScript ni red, HTML escapado por `Code.js` (`escaparHtml`); el contenedor sin capacidades, usuario 10001 y raíz de solo lectura |
| R14 | Memoria con cuerpos grandes a la vez (fotos de 20 renglones) | Pico de cientos de MB | Límite de 50 MB por llamada (nginx y servicio), `mem_limit` 1200 MB, 3 trabajadores; `unzip` con tope de 60 MB |
| R15 | Pestañas abiertas con la interfaz vieja después del cambio | Ven "CAPRI se cambió… recarga" | Por diseño (`API_MUDADA`) |
| R16 | La búsqueda global por nombre de Drive (`DriveApp.getFilesByName`, solo al importar el SAT) ve lo de facilities@ y lo compartido con ella | Solo en la importación del SAT | Correr esa importación en Apps Script o compartir los CSV con facilities@ |
| R17 | Latencia real a Google desde helgensrvr; si el puerto 80 llega desde Internet (certbot) | | `revisar-servidor.sh`; `nginx-capri.sh certificado` lo prueba |
| R18 | Lo que se sabe de carpetas de Drive se recuerda 60 s: una carpeta mandada a la Papelera a mano se puede seguir usando ese minuto (Apps Script lo veía al instante) | Raro; el archivo quedaría en la Papelera | `driveTtlMs` más bajo si hace falta; las subcarpetas se reparan solas al siguiente guardado (§6.9) |
| R19 | **La imagen no se construyó contra Docker Hub real** (aquí no hay salida a Docker Hub, Debian ni Chrome for Testing): se probó con una base de sustitución con el mismo Node, sin los paquetes de Debian ni Chromium | La primera construcción en helgensrvr puede fallar en `apt-get` o en la descarga de Chromium; nada más cambia | `preparar-servidor.sh` lo dice al momento; el `ldd` del Dockerfile detiene la construcción si falta una librería |
| R20 | Node 22 termina su soporte en abril de 2027; la base no lleva digest fijo | | Subir a Node 24 (cambiar `NODE_IMAGE` y correr la etapa `pruebas`); fijar el digest que imprime `preparar-servidor.sh` |
| R21 | Chrome for Testing solo existe para amd64 | Si helgensrvr fuera arm64, Chromium de Debian (otra versión) | `revisar-servidor.sh` muestra la arquitectura |
| R22 | Lo que Apps Script hace al descomprimir (`Utilities.unzip`) y que no está documentado: tipo MIME de cada archivo | El incremento 7 debe decidir por el nombre del archivo, no por su tipo | Tipo por extensión (`.xml` → `application/xml`); anotado para el incremento 7 |

## 15. Lo que falta hasta la corrida de sombra

**Listo en el repositorio (29/10):** imagen y `docker-compose.yml`, nginx + certbot con su script de instalación, scripts
de revisión, preparación y actualización (con regreso), herramientas para tokens, propiedades, salud, sombra y la tabla de
escritura; escritura USER_ENTERED; puentes del incremento 7. Probado aquí todo lo que no necesita Google real ni Docker Hub
(§16 y R19).

**Lo que pone Leo:**
1. Pasos 1–6 de la guía de Google (proyecto en la organización, 3 API, pantalla Interna, permisos, cliente de escritorio,
   app de confianza) y estar como facilities@ en el paso 7.
2. Que Gibran tenga sudo en helgensrvr y acceso para clonar el repositorio (`ssh://git@git.helgen.online:222/leo/cotizador-helgen.git`,
   espejo de solo lectura de GitHub: se sube a GitHub y se pulsa «Sincronizar ahora» en el espejo; o GitHub con una llave de despliegue).
3. Su ID token para la sombra (y uno de cada rol, o las pruebas las hace Claude con Chrome).
4. La función de la tabla de escritura en Apps Script (`servidor-comandos.md` E3).

**Trabajo (días hábiles):**

| Tarea | Días |
|---|---:|
| Instalar en el servidor (revisar, preparar, nginx/certbot, tokens, propiedades) y primer arranque real | 0.5 |
| Primer contacto con Google real: ajustar adaptadores (máscaras, rangos, Drive), cargar los 5 libros, medir | 1–1.5 |
| Chromium real: PDF de cotización, OC y solicitud lado a lado con los de Google; ajustar | 0.5–1 |
| Corrida de sombra: 2 rondas con todos los roles, corregir diferencias (fechas, visibles, orden); tabla de escritura con Apps Script | 1–2 |
| Alertas mínimas (token revocado, fallas de confirmación, deriva) por correo o Mattermost | 0.5 |
| Arnés (`tests/arnes.js`) con formatos de celda: hoy su `setNumberFormat` es un simulacro vacío, así que convierte toda fecha ISO en Date (y la serializa en UTC) aunque la hoja esté en "@" — el servidor es más fiel. Mientras tanto `pruebas/paridad.test.js` compara las marcas de tiempo solo por su presencia, con el porqué anotado | 0.5 |
| **Total hasta una sombra limpia** | **≈ 4–6** |
| Después: ensayo con escritura en copias + publicar la costura con los incrementos 5–7 + cambio (§12.1–12.2) | 1 + una noche |

## 16. Pruebas y cómo correrlas

```bash
cd servidor && npm ci && npm test        # o desde la raíz: bash tests/todas.sh (incluye estas si hay node_modules)
node --expose-gc pruebas/medir.js        # mediciones del §3 y §11 (LATENCIA=0 para solo el proceso)
```

| Prueba | Qué revisa |
|---|---|
| `pruebas/paridad.test.js` | El escenario completo (31 llamadas) por el arnés y por HTTP: respuestas idénticas byte a byte (reloj fijo), mismas hojas, archivos, carpetas con su acceso y correos; tabla de tiempos por llamada; reparte las llamadas entre los 3 trabajadores (consistencia entre copias). Única diferencia conocida: el servidor sí crea la pestaña "Tipo de cambio" (el arnés no tiene `getParent`/`setFormula`; el catálogo real ya la tiene). |
| `pruebas/servidor.test.js` | Lecturas en paralelo a una escritura; dos escrituras en serie; Sheets que rechaza (error, nada a medias, folio sin gastar, repetir); edición a mano (sondeo, versiones, consulta; frescura al tomar el candado); corte por tiempo (también esperando el candado); solo lectura; HTTP (CORS, 404, 413, `/salud`, `/admin/correr` solo local); activadores declarados y de `Code.js`; caché y propiedades tras reiniciar. |
| `pruebas/google.test.js` | Adaptadores de Sheets, Drive y Gmail contra HTTP simulado: carga acotada (fechas, fórmulas, errores, visibles, rangos con nombre), diario → `batchUpdate` (valores tipados, crecer cuadrícula, formatos, estilos, validación, protección, nombres, hoja nueva, borrar fila), lectura de regreso, 429 sí / 500 no, espejo canónico ante una falla, Drive (comillas, multipart, mover, personas, contenido), `privado_`, MIME de Gmail. |
| `pruebas/identidad.test.js` | Verificación local del token (firma, emisor, audiencia, vencimiento, algoritmo, carga alterada) y de punta a punta con `Code.js`. |
| `pruebas/unidades.test.js` | Modelo, A1, fechas ↔ serie (con horario de verano de 2022), parches, texto plano por tramos, `formatDate`, base64, digests, CSV, `getAs` PDF, candado, motor de PDF con navegador falso, `Utilities.unzip` (ZIP de Python; carpetas, bytes con signo, bomba, tope de 60 MB), Chromium del Dockerfile = el de puppeteer-core. |
| `pruebas/escritura.test.js` | La tabla de escritura (49 casos: números, fechas, horas, apóstrofo, `+52…`, fórmulas, booleanos, locale, formato de la celda) por el camino real hasta la `batchUpdate`; la fachada con texto plano cargado de Sheets y puesto por `setNumberFormat`; carga y lectura de regreso del locale y el texto plano; la función de Apps Script que genera `paridad-escritura.js` corre y `comparar` sale igual. |
| `pruebas/puentes.test.js` | Lo que llama el incremento 7, en un trabajador real: Drive (`createFile` con Blob de bytes con signo, `getBlob`, `moveTo`, `setTrashed`), Utilities (base64, MD5 web-safe de texto y de Byte[], `formatDate` con los patrones que usa), Sheets (`deleteRows`, `getDataRange().getValues()`, fecha/apóstrofo/fórmula, límite de 50 000 caracteres), `unzip`; el activador de 15 min declarado se crea y corre. |
| `pruebas/sombra.test.js` | La herramienta de sombra con dos servidores: iguales; una edición a mano sale como distinta. |
| `tests/mudanza.test.js` | La costura `API_MUDADA`. |

**Docker y nginx** (no son pruebas automáticas; así se probaron el 29/10, con una base de sustitución porque aquí no hay
salida a Docker Hub): el Dockerfile real se construye y la etapa `pruebas` pasa las 8 pruebas dentro de la imagen como el
usuario 10001 con la raíz de solo lectura; con el `docker-compose.yml` real: sano en 5 s, puerto solo en 127.0.0.1,
`/salud` sin detalle y `/admin/correr` 404 desde fuera, CORS solo para Cloudflare, `EROFS` fuera de `/var/lib/capri` y
`/tmp`, `drogheda.helgen.online` → la puerta del servidor, apagado en orden con tini; nginx 1.24 con el archivo de drogheda
al lado (`nginx -t`, redirección, reto ACME, CORS, origen ajeno, 413/429/reinicio en JSON); `actualizar.sh` contra un origen
de prueba (cambio sano, arranque roto con regreso solo, `--regresar`). `hadolint` y `shellcheck` sin observaciones.
