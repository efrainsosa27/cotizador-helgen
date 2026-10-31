# CAPRI en su servidor — Google, paso a paso

Para **Leo** (super admin de Google Workspace de helgen.tech). Es la parte de Google de la etapa 1: que el servidor
`capri.helgen.online` pueda leer y escribir los mismos libros y carpetas y mandar los mismos correos que hoy manda Apps
Script, **como facilities@helgen.tech**, sin llaves maestras. Los comandos exactos, en orden y para copiar, están en
[`servidor-comandos.md`](servidor-comandos.md); el diseño, en [`servidor-etapa-1.md`](servidor-etapa-1.md).

**Quién hace qué** (marcado en cada paso):

| Quién | Qué |
|---|---|
| **[Leo]** | Google Cloud Console, consola de administración de Google, Script Properties, la interfaz en Cloudflare. |
| **[facilities@]** | La cuenta que autoriza al servidor y que corre la función temporal de exportar propiedades. La usa Leo (tiene su contraseña), en un perfil de Chrome aparte o en una ventana de incógnito para no mezclarla con leo@. |
| **[Gibran]** | Todo lo que se escribe en el servidor (helgensrvr). |

**Reglas de los secretos.** Ningún secreto (archivo del cliente OAuth, tokens, Script Properties, ID tokens) va al
repositorio, al chat, a un correo ni a Mattermost. Los archivos de secretos viven solo en el servidor, con dueño `capri`
y permisos `600`. Si alguno se filtra: revocarlo (paso 11) y repetir el paso que lo creó.

---

## Paso 1 — Proyecto de Google Cloud dentro de la organización [Leo]

La pantalla de consentimiento **Interna** (solo cuentas de helgen.tech; sin revisión de Google; los tokens no vencen a
los 7 días) solo existe en proyectos **de la organización** helgen.tech.

1. Abre <https://console.cloud.google.com> con leo@helgen.tech.
2. Arriba, en el selector de proyectos → **Nuevo proyecto**.
   - Nombre: `capri-servidor`.
   - **Organización: `helgen.tech`** y Ubicación: `helgen.tech` (si no aparece la organización, ver el recuadro).
   - **Crear**.
3. Comprueba: selector de proyectos → el proyecto `capri-servidor` debe aparecer **debajo de helgen.tech**, no en "Sin
   organización".

> **Si no aparece la organización helgen.tech:** abre <https://console.cloud.google.com/iam-admin/settings> con leo@: si
> dice "Organización: helgen.tech", ya existe (vuelve a intentar el paso 2 eligiéndola en Ubicación). Si no existe, Google
> la crea sola la primera vez que un super admin de Workspace entra a Cloud Console y acepta las condiciones; recarga y
> repite.

**Por qué un proyecto nuevo** (y no el del Client ID de la interfaz, `884526916417`): así los permisos del servidor
quedan separados del inicio de sesión de la interfaz, que no se toca (sigue en External/Testing, CLAUDE.md §10.1). El
servidor verifica los ID tokens de la interfaz con las llaves públicas de Google: no necesita estar en el mismo proyecto.

## Paso 2 — Activar las API [Leo]

En el proyecto `capri-servidor`: menú ☰ → **APIs y servicios → Biblioteca**. Busca cada una, ábrela y da **Habilitar**:

1. **Google Sheets API**
2. **Google Drive API**
3. **Gmail API**

Comprueba en **APIs y servicios → APIs y servicios habilitados** que están las tres.

## Paso 3 — Pantalla de consentimiento: Interna [Leo]

Menú ☰ → **Google Auth Platform** (en español puede decir "Plataforma de Google Auth"). Si pide **Comenzar**:

1. **Información de la app:** nombre `CAPRI servidor`; correo de asistencia del usuario: `leo@helgen.tech`. **Siguiente**.
2. **Público: Interno**. **Siguiente**.
3. **Información de contacto:** `leo@helgen.tech`. **Siguiente** → acepta la política → **Crear**.

Si ya existía: **Público** → debe decir **Tipo de usuario: Interno** (si dice Externo: **Convertir en interna**).

## Paso 4 — Permisos (alcances) [Leo]

**Google Auth Platform → Acceso a los datos → Agregar o quitar permisos.** Marca (usa el filtro para encontrarlos) o pega
en "Agregar permisos manualmente":

| Permiso | Para qué |
|---|---|
| `https://www.googleapis.com/auth/spreadsheets` | Leer y escribir los libros de CAPRI |
| `https://www.googleapis.com/auth/drive` | Carpetas, PDF, comprobantes, fotos, permisos (`privado_`) — lo mismo que hoy usa Apps Script |
| `https://www.googleapis.com/auth/gmail.send` | Mandar los avisos como facilities@ (solo mandar: no lee el buzón) |
| `openid` y `https://www.googleapis.com/auth/userinfo.email` | Que la herramienta compruebe que quien autorizó es facilities@ |

**Actualizar** → **Guardar**. En una app Interna estos permisos no requieren verificación de Google.

Son exactamente los alcances que hoy tiene la API de Apps Script (que corre como facilities@): el servidor no puede hacer
nada que hoy no pueda hacer CAPRI.

## Paso 5 — Cliente OAuth "App de escritorio" [Leo]

**Google Auth Platform → Clientes → Crear cliente.**

1. Tipo de aplicación: **App de escritorio**. Nombre: `capri-autorizar`. **Crear**.
2. En la ventana que aparece: **Descargar JSON** (se baja `client_secret_….json` a la Mac).
3. Ese archivo es un secreto del proyecto: no lo mandes por chat ni correo. Súbelo directo al servidor (comando en
   `servidor-comandos.md`, paso B4) y bórralo de la Mac.

## Paso 6 — Que Workspace confíe en la app [Leo]

Si helgen.tech restringe las apps de terceros, facilities@ no podrá autorizar. En <https://admin.google.com>:

1. **Seguridad → Acceso y control de datos → Controles de API**.
2. En **Configuración** (o "Configuración de apps internas"): debe estar marcada **"Confiar en las apps internas
   propiedad del dominio"**. Si lo está, ya terminaste este paso.
3. Si no quieres marcarla: **Administrar el acceso de apps de terceros → Configurar una app nueva → ID de cliente de
   OAuth**, pega el Client ID de `capri-autorizar` (Cloud Console → Clientes), elige la app, **Toda la organización** →
   **De confianza** → **Configurar**.
4. facilities@ ya manda correo hoy (MailApp): Gmail está activo para esa cuenta. Nada que cambiar.

## Paso 7 — Autorizar al servidor como facilities@ (dos tokens) [Gibran] [facilities@]

Se hace **dos veces**: un token con Sheets + Drive y otro **solo** con `gmail.send`. Así, si un día cambia la contraseña
de facilities@ (Google revoca los tokens que tienen Gmail), solo se apagan los correos y CAPRI sigue funcionando.

1. [Gibran] deja el archivo del paso 5 en `/srv/capri/config/cliente-oauth.json` (dueño capri, 600) — `servidor-comandos.md` C1.
2. [Leo], en la Mac, abre un túnel al servidor (la herramienta recibe la respuesta de Google en `127.0.0.1:8765`):
   `ssh -L 8765:127.0.0.1:8765 leo@git.helgen.online` y deja esa terminal abierta.
3. [Leo] En esa misma terminal (la del túnel, ya dentro del servidor) corre el comando C2 de `servidor-comandos.md` (`autorizar.js --alcances hojas,drive`).
   Imprime una liga larga de `accounts.google.com`.
4. [facilities@] Abre la liga en el Chrome **donde está entrada facilities@** (perfil aparte o incógnito). Google muestra "CAPRI
   servidor quiere acceder a tu cuenta de Google": revisa que diga **facilities@helgen.tech** y que pida Hojas de cálculo
   y Drive → **Permitir** (o **Continuar**).
5. El navegador muestra "Listo: … guardado para facilities@helgen.tech" y la terminal `✔ Guardado …`. Si dice "entraste
   como otra cuenta", repite con la ventana de facilities@.
6. Repite 3–5 con el comando C3 (`--alcances correo`): ahora Google pide solo **Enviar correo electrónico en tu nombre**.
7. [Gibran] borra `cliente-oauth.json` (C4). Los dos tokens ya llevan lo que necesitan.

**Dónde queda cada secreto** (todo fuera del repositorio y de la imagen; Docker monta `config` en solo lectura):

| Archivo en el servidor | Qué guarda | Dueño y permisos | Lo crea |
|---|---|---|---|
| `/srv/capri/config/capri.json` | Configuración (sin secretos) | capri · 600 | `preparar-servidor.sh` |
| `/srv/capri/config/google-facilities.json` | Token de facilities@: Sheets + Drive | capri · 600 | paso 7 |
| `/srv/capri/config/google-facilities-correo.json` | Token de facilities@: solo `gmail.send` | capri · 600 | paso 7 |
| `/srv/capri/datos/propiedades.json` | Script Properties (incluye `SESION_SECRETO`, `PORTAL_SECRETO`, `ANTHROPIC_API_KEY`) | capri · 600 | paso 8 (y el servicio) |
| `/srv/capri/datos/cache.json`, `estado.json` | Caché (idempotencia, bloqueos de códigos), activadores y cuota de correo | capri · 600 | el servicio |
| `/srv/capri/config/cliente-oauth.json` | Cliente OAuth del paso 5 | capri · 600 | **solo durante el paso 7**; luego se borra |

`capri` es un usuario del sistema sin acceso (UID 10001, el mismo con el que corre el contenedor). Las carpetas
`/srv/capri/config` y `/srv/capri/datos` son 700: solo root y capri las leen.

## Paso 8 — Copiar las Script Properties al servidor [facilities@] [Gibran]

Se hace **dos veces**: al empezar la sombra (para que el servidor lea lo mismo) y la noche del cambio (paso 12, con
Apps Script ya detenido). Nada se imprime: el archivo va de Drive al servidor y se borra de Drive para siempre.

1. [facilities@] Con facilities@ abre el editor del proyecto de la API
   (<https://script.google.com/home/projects/1GsH8DjaFEZ9dltqBUTUEFE_frblSYimRRCvPkqKdRB5UhmBwwYHLSwyS/edit>).
2. **Archivos → + → Secuencia de comandos**, nombre `temporal`. Pega:

   ```javascript
   function exportarPropiedadesTemporal() {
     const p = PropertiesService.getScriptProperties().getProperties();
     const f = DriveApp.createFile('capri-propiedades.json', JSON.stringify(p), 'application/json');
     privado_(f); // restringido (§6.11 de CLAUDE.md)
     console.log('ID para el servidor: ' + f.getId());
   }
   ```

3. Elige `exportarPropiedadesTemporal` → **Ejecutar**. En el registro sale `ID para el servidor: 1Ab…` (el ID no es
   secreto; el contenido sí, y queda en el Drive de facilities@ restringido).
4. **Borra el archivo `temporal`** (⋮ → Eliminar). Así el código del editor vuelve a ser igual al del repositorio.
5. [Gibran], con el ID: comando D1 de `servidor-comandos.md` (`propiedades.js importar-drive <ID> … --borrar`). Dice
   cuántas propiedades importó, avisa si falta alguna necesaria y **elimina el archivo de Drive definitivamente** (no va
   a la Papelera).

> Debe correrlo **facilities@**: el archivo queda en su Drive y el servidor (que es facilities@) lo puede leer. Si lo corre
> leo@, el servidor no lo ve (`importar-drive` dice 404).

## Paso 9 — Corrida de sombra (antes del cambio) [Leo] [Gibran]

El servidor corre en **solo lectura** con los datos reales (así lo deja `preparar-servidor.sh`): no escribe en Sheets,
no crea nada en Drive, no manda correos, no corre el activador. Apps Script sigue siendo el único que escribe.

1. [Leo] En CAPRI (la de siempre, en Chrome, como leo@) abre la consola (⌥⌘J) y escribe
   `copy(localStorage.getItem('cotizadorHelgenSesion'))`: copia tu ID token (vale ~1 h). **No lo pegues en ningún chat.**
2. [Gibran] En el servidor, el comando E1 de `servidor-comandos.md`: pide pegar el token sin mostrarlo, manda **solo lecturas**
   (21 funciones + detalles reales) a Apps Script y al servidor, compara y mide. Con `--reintentar`, lo distinto se repite a
   los 75 s (alguien pudo guardar en ese minuto).
3. Criterio para pasar al cambio (diseño §12.1): todo igual en **2 corridas en días distintos** (o cada diferencia
   explicada), tiempos registrados, el **ensayo con escritura** en los archivos PRUEBAS y la **tabla de escritura**
   confirmada con Apps Script (E3: `paridad-escritura.js`).

## Paso 10 — Publicar la costura `API_MUDADA` en Apps Script (días antes) [Leo] [facilities@]

El cambio se hace poniendo una propiedad en Apps Script (paso 12) y el regreso, quitándola. Para eso, el `Code.js`
**publicado** en Apps Script debe traer la costura `API_MUDADA` (11 líneas; sin la propiedad no cambia nada).

- La costura está en `Code.js` desde la rama `incremento-7` (= `servidor-etapa-1` desde el 29/10/2026), que incluye los
  **incrementos 5, 6 y 7 (sin publicar)**: publicarlos con su lista de pasos de siempre (respaldo, `clasp push`,
  `prepararCapri()` y nueva versión del deployment `AKfycbwBjF7…` **como facilities@**, CLAUDE.md §9) publica también la
  costura. No hace falta publicarla aparte.
- **El servidor y Apps Script deben correr el mismo `Code.js`.** El servidor toma el código de la rama que despliega
  (`actualizar.sh`); si después se publica en Apps Script un incremento nuevo, actualizar el servidor a ese mismo commit antes
  de la sombra o del cambio.
- Comprueba después: en el editor, `doPost` empieza con `if (propiedades_().API_MUDADA) throw errorMudada_();`.

## Paso 11 — Revocar o renovar un token (si hace falta) [Leo]

- Ver o quitar: <https://myaccount.google.com/permissions> **como facilities@** → "CAPRI servidor" → **Quitar acceso**
  (revoca los dos tokens). O en admin.google.com → Seguridad → Controles de API → Apps → CAPRI servidor.
- Google los revoca solo si cambia la contraseña de facilities@ (el de correo), si alguien quita el acceso o tras 6 meses
  sin uso. Síntoma: `salud` muestra errores de Google y en el registro aparece `invalid_grant`.
- Arreglo: repetir el paso 7 (solo el token afectado) y `sudo docker compose restart capri`.

## Paso 12 — La noche del cambio [Leo] [facilities@] [Gibran]

Comandos completos: `servidor-comandos.md`, sección F. Una sola persona guarda a la vez (nadie usando CAPRI), ~30 min.

1. [Leo] Aviso al equipo; respaldo de los libros como siempre (CLAUDE.md §2).
2. [Leo] **Apps Script deja de escribir:** editor del proyecto `1GsH8Dja…` → **Configuración del proyecto** (el engrane de la izquierda) → Propiedades de
   la secuencia de comandos → Agregar propiedad**: `API_MUDADA` = `https://capri.helgen.online` → **Guardar**. Desde ese
   momento toda llamada (y el activador de 15 min) contesta "CAPRI se cambió a su servidor nuevo. Recarga la página…".
3. [facilities@] [Gibran] Paso 8 otra vez (las propiedades más nuevas; `importar-drive` quita `API_MUDADA`).
4. [Gibran] Servidor a escritura: `soloLectura: false` y reinicio (F3). `salud` debe decir `"soloLectura": false` y
   `"activadores": ["cadaQuinceMinutos"]`.
5. [Leo] Interfaz: `API_URL = 'https://capri.helgen.online/api'` en `web/cotizador/index.html` y
   `CLOUDFLARE_ACCOUNT_ID=badd8bca60b008822a73ca24e983ff43 npx --yes wrangler@4 deploy` (F4). Siempre con esa cuenta: con
   la sesión de leo@, wrangler elige su cuenta propia.
6. Revisión (F5): entrar, Pendientes, una lectura de cada pestaña, un guardado de prueba marcado como prueba (CLAUDE.md §5),
   el registro sin errores. Las pestañas que se quedaron abiertas con la interfaz vieja ven "CAPRI se cambió… recarga".

## Paso 13 — Regreso a Apps Script (si algo sale mal) [Leo] [Gibran]

Comandos: `servidor-comandos.md`, sección G. Minutos.

1. [Gibran] Servidor a solo lectura y reinicio (deja de escribir: un solo escritor).
2. [Gibran] Lista de lo que cambió en el servidor y hay que llevar a Apps Script: las `SESION_DESDE_*` (sesiones de CAPRI
   cerradas; no son secretos). Los `VER_*` y `CONSECUTIVO_*` no hace falta (el folio sale del mayor entre el contador y la
   hoja).
3. [Leo] En Script Properties de Apps Script: agrega esas `SESION_DESDE_*` y **borra `API_MUDADA`**. Apps Script vuelve a
   atender y su activador a correr.
4. [Leo] Interfaz: `API_URL` de regreso al deployment de Apps Script y `wrangler deploy` (o `wrangler rollback` a la versión
   anterior).

Las claves de idempotencia del servidor no pasan a Apps Script: un doble clic justo en el regreso podría duplicar; hacerlo
sin gente guardando.
