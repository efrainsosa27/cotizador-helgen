# CAPRI en su servidor — comandos, en orden

Lista para copiar y pegar, de la instalación al cambio y el regreso. El porqué de cada paso de Google está en
[`servidor-google-paso-a-paso.md`](servidor-google-paso-a-paso.md); el diseño, en [`servidor-etapa-1.md`](servidor-etapa-1.md).

- **[Gibran]** = en el servidor (helgensrvr = `git.helgen.online` por SSH, puerto 22), con su usuario y `sudo`. **[Leo]** = Google, Apps Script, la interfaz.
  **[facilities@]** = Leo entrando con esa cuenta. **[Verificar]** = qué debe salir.
- `<usuario>` = tu usuario de SSH en el servidor (la misma máquina que `drogheda.helgen.online` y `git.helgen.online`).
- Docker se usa con `sudo` (así funciona aunque tu usuario no esté en el grupo `docker`).
- Nunca pegues un secreto (tokens, Script Properties, el JSON del cliente OAuth, tu ID token) en el chat ni en un correo.

---

## A0. Subir el código al repositorio (una vez) — [Leo]

Claude no puede escribir en `git.helgen.online`: el código llega como *bundle* de git
(`entregas/incremento-7/capri-incrementos-5-6-7-servidor.bundle`, historia completa: no necesita los bundles anteriores).
En tu Mac, en tu copia del repositorio (`origin` = `git.helgen.online`):
```bash
cd ~/Documents/Claude/Projects/cotizador-helgen
B=entregas/incremento-7/capri-incrementos-5-6-7-servidor.bundle
git bundle verify "$B"
git fetch "$B" incremento-5:incremento-5 incremento-6-final:incremento-6 incremento-7:incremento-7 servidor-etapa-1:servidor-etapa-1
git push origin incremento-5 incremento-6 incremento-7 servidor-etapa-1
```
[Verificar] `git bundle verify` dice "is okay"; el push crea las cuatro ramas. `incremento-7` y `servidor-etapa-1` apuntan al mismo
commit (el servidor corre el mismo `Code.js` que se publicará en Apps Script). Gibran necesita acceso de lectura a
`leo/cotizador-helgen` con la llave SSH de su usuario en el servidor (la usa `actualizar.sh` con `git fetch`).

## A. Preparar el servidor (una vez) — [Gibran]

**A1. Código y revisión (solo lee).**
```bash
sudo mkdir -p /srv/projects/capri && sudo chown "$USER": /srv/projects/capri
git clone ssh://git@git.helgen.online:222/leo/cotizador-helgen.git /srv/projects/capri/app
cd /srv/projects/capri/app && git checkout servidor-etapa-1
sudo bash servidor/despliegue/revisar-servidor.sh 2>&1 | tee ~/revision-servidor.txt
```
[Verificar] Arquitectura `x86_64`; Docker y `docker compose` con versión; puertos 8090 libre; `UID 10001 libre`; certbot y
`/etc/letsencrypt/options-ssl-nginx.conf` presentes; salida a Google, a `registry-1.docker.io`, `registry.npmjs.org`,
`storage.googleapis.com` y `deb.debian.org` con un código HTTP (no `000`). Manda `~/revision-servidor.txt` a Leo.

**A2. Usuario `capri`, carpetas, configuración e imagen.**
```bash
cd /srv/projects/capri/app
sudo bash servidor/despliegue/preparar-servidor.sh /srv/projects/capri/app
```
[Verificar] `/srv/capri/config` y `/srv/capri/datos` con `drwx------ 10001 10001`; `capri.json` con `-rw------- 10001`;
"capri:<commit> construida". La primera construcción tarda unos minutos (baja Node, Debian y Chromium).

**A3. nginx y certificado** (no toca drogheda; si una prueba falla, regresa solo).
```bash
cd /srv/projects/capri/app
sudo bash servidor/despliegue/nginx-capri.sh certificado    # puerto 80 + certbot certonly --webroot
sudo bash servidor/despliegue/nginx-capri.sh aplicar        # 443 → 127.0.0.1:8090, con pruebas
sudo certbot renew --dry-run --cert-name capri.helgen.online
```
[Verificar] `aplicar` termina en "Listo (N pruebas)" y "los demás sitios (drogheda) siguen idénticos". Como el servicio aún
no corre, la API contesta `"codigo":"REINICIO"` (es lo esperado). `renew --dry-run` dice "Congratulations, all simulated
renewals succeeded".

## B. Google (una vez) — [Leo]

**B1–B3.** Pasos 1 a 6 de [`servidor-google-paso-a-paso.md`](servidor-google-paso-a-paso.md): proyecto `capri-servidor`
en la organización, Sheets/Drive/Gmail API, consentimiento **Interno**, permisos, cliente **App de escritorio**
`capri-autorizar` (se baja `client_secret_….json`) y la app como de confianza en admin.google.com.

**B4. Subir el cliente OAuth al servidor** (en la Mac):
```bash
scp ~/Downloads/client_secret_*.json leo@git.helgen.online:/tmp/cliente-oauth.json && rm ~/Downloads/client_secret_*.json
```

## C. Los dos tokens de facilities@ (una vez) — [Gibran] [Leo] [facilities@]

**C1. [Gibran]** El cliente OAuth a su lugar:
```bash
sudo install -o capri -g capri -m 600 /tmp/cliente-oauth.json /srv/capri/config/cliente-oauth.json && sudo rm /tmp/cliente-oauth.json
```
**[Leo]** En la Mac, un túnel (deja esta terminal abierta; ahí mismo se corren C2 y C3):
```bash
ssh -L 8765:127.0.0.1:8765 leo@git.helgen.online
```
**C2. [Leo]** Token de Sheets + Drive. En la sesión del túnel (la liga de Google regresa a tu Mac por el túnel):
```bash
cd /srv/projects/capri/app/servidor
sudo docker compose run --rm -p 127.0.0.1:8765:8765 -v /srv/capri/config:/salida capri \
  node herramientas/autorizar.js --cliente /salida/cliente-oauth.json --alcances hojas,drive \
  --salida /salida/google-facilities.json --escuchar 0.0.0.0
```
**[facilities@]** Abre la liga que imprime en el Chrome de facilities@ → revisa que diga facilities@helgen.tech → **Permitir**.
[Verificar] Terminal: `✔ Guardado /salida/google-facilities.json (hojas, drive) para facilities@helgen.tech, con permisos 600.`

**C3.** Token solo de correo (igual, otra vez):
```bash
sudo docker compose run --rm -p 127.0.0.1:8765:8765 -v /srv/capri/config:/salida capri \
  node herramientas/autorizar.js --cliente /salida/cliente-oauth.json --alcances correo \
  --salida /salida/google-facilities-correo.json --escuchar 0.0.0.0
```
**C4. [Gibran]** Borrar el cliente y revisar:
```bash
sudo rm /srv/capri/config/cliente-oauth.json && sudo ls -ln /srv/capri/config
```
[Verificar] Tres archivos, todos `-rw------- 10001 10001`: `capri.json`, `google-facilities.json`, `google-facilities-correo.json`.

## D. Propiedades y arranque en solo lectura (sombra) — [facilities@] [Gibran]

**D0. [facilities@]** Paso 8 de la guía: archivo `temporal` en el editor de Apps Script, **Ejecutar**
`exportarPropiedadesTemporal`, anotar el ID que imprime, **borrar el archivo `temporal`**.

**D1. [Gibran]** Importar (nada se imprime; el archivo se elimina de Drive) y arrancar:
```bash
cd /srv/projects/capri/app/servidor
sudo docker compose stop capri
sudo docker compose run --rm capri node herramientas/propiedades.js importar-drive <ID> /var/lib/capri/propiedades.json --borrar
sudo docker compose up -d
sudo docker compose exec capri node herramientas/admin.js salud | tail -60
curl -s https://capri.helgen.online/salud; echo
```
[Verificar] `✔ N propiedades … eliminado de Drive (definitivo)` y ningún "faltan"; `salud`: `"soloLectura": true`,
`"backend": "google"`, 3 trabajadores `"listo": true`, los 5 libros con su `"locale"` y `"zona": "America/Mexico_City"`,
y al final `✔ sano`. Desde fuera: `{"ok":true}`. Anota el `locale` de los libros para E3.

## E. Corrida de sombra y tabla de escritura (antes del cambio) — [Leo] [Gibran]

**Antes de E1:** Apps Script y el servidor deben correr **el mismo `Code.js`**. Hoy Apps Script tiene el incremento 4 (@13) y el
servidor, los incrementos 5–7: primero se publican los incrementos 5, 6 y 7 en Apps Script (`PUBLICAR-incremento-7.md`; trae
la costura `API_MUDADA`, que sin la propiedad no hace nada) y después se corre la sombra. Con versiones distintas, la sombra solo
mide diferencias de código.

**E1. [Leo]** En la pestaña de CAPRI (Chrome, como leo@), consola (⌥⌘J): `copy(localStorage.getItem('cotizadorHelgenSesion'))`.
Luego en el servidor (el token no se ve, no queda en el historial y vale ~1 h):
```bash
cd /srv/projects/capri/app/servidor
read -rs -p 'ID token: ' CAPRI_TOKEN && export CAPRI_TOKEN && echo
sudo --preserve-env=CAPRI_TOKEN docker compose exec -e CAPRI_TOKEN capri node herramientas/sombra.js \
  --apps https://script.google.com/macros/s/AKfycbwBjF7ra_4O8INsxBq0eh-4r-BlSsJ4LLxcJgVCPRpx1U1a-Pz1CUSdYtvj_Mh0S6y2/exec \
  --servidor http://127.0.0.1:8090/api --reintentar --salida "/var/lib/capri/sombra-$(date +%F).json"
unset CAPRI_TOKEN
```
[Verificar] "N de N iguales" y las dos medianas de tiempo. Cada "DISTINTO" se explica o se corrige antes del cambio.

**E2.** Repetir E1 otro día (criterio: dos corridas limpias en días distintos).

**E3. [Leo]** Confirmar con Apps Script real cómo guarda Sheets lo que se escribe (números, fechas, `'`, `+52…`, fórmulas).
En tu copia del repositorio (Mac, con Node):
```bash
git fetch && git checkout servidor-etapa-1
node servidor/herramientas/paridad-escritura.js codigo > /tmp/paridad.gs
```
Abre <https://script.new> como leo@ → pega `/tmp/paridad.gs` → **Ejecutar** `paridadEscrituraTemporal` (crea dos hojas de
prueba y las manda a la Papelera) → copia la línea `{"apps":[…]}` del registro a `/tmp/resultado.json`:
```bash
node servidor/herramientas/paridad-escritura.js comparar /tmp/resultado.json
```
[Verificar] "49 de 49 iguales". Si algo difiere, o si en D1 los libros no dicen `es_MX`, pásale la salida a Claude: se
ajusta `src/espejo/entrada.js` y la tabla antes del cambio.

**E4.** Ensayo con escritura en los archivos PRUEBAS (diseño §12.1) y la costura `API_MUDADA` publicada en Apps Script con
el siguiente incremento (guía, paso 10).

## F. La noche del cambio (~30 min, nadie guardando) — [Leo] [facilities@] [Gibran]

**F1. [Leo]** Aviso al equipo y respaldo de los libros (CLAUDE.md §2). Luego, en el editor del proyecto `1GsH8Dja…` →
Configuración del proyecto → Propiedades de la secuencia de comandos → **Agregar**: `API_MUDADA` = `https://capri.helgen.online`
→ **Guardar**. Apps Script deja de escribir (y su activador de correr).

**F2. [facilities@] [Gibran]** Propiedades frescas (D0 otra vez para el ID) y a escritura:
```bash
cd /srv/projects/capri/app/servidor
sudo docker compose stop capri
sudo docker compose run --rm capri node herramientas/propiedades.js importar-drive <ID> /var/lib/capri/propiedades.json --borrar
```
**F3. [Gibran]**
```bash
sudo sed -i 's/"soloLectura": true/"soloLectura": false/' /srv/capri/config/capri.json && sudo grep -n soloLectura /srv/capri/config/capri.json
sudo docker compose up -d
sudo docker compose exec capri node herramientas/admin.js salud | grep -E '"soloLectura"|"activadores"|sano' -A1
```
[Verificar] `"soloLectura": false`, `"activadores": [ "cadaQuinceMinutos" ]`, `✔ sano`.

**F4. [Leo]** La interfaz llama al servidor (en tu copia del repositorio, Mac):
```bash
perl -pi -e "s#const API_URL = 'https://script\.google\.com/macros/s/AKfycbwBjF7[^']*/exec';#const API_URL = 'https://capri.helgen.online/api';#" web/cotizador/index.html
grep -n "const API_URL" web/cotizador/index.html
CLOUDFLARE_ACCOUNT_ID=badd8bca60b008822a73ca24e983ff43 npx --yes wrangler@4 deploy
git commit -am "Interfaz: API_URL al servidor propio (etapa 1)" && git push
```
[Verificar] `grep` muestra `https://capri.helgen.online/api`; wrangler imprime la versión publicada (anótala para G3).

**F5. [Verificar]** (Leo en el navegador; Gibran mira el registro):
```bash
curl -s https://capri.helgen.online/salud; echo                                   # {"ok":true}
sudo docker logs -f --since 10m capri 2>&1 | grep --line-buffered -E '"texto":"llamada"|"nivel":"error"'
```
Recargar CAPRI → entrar → Pendientes → una lectura de cada pestaña → un guardado de prueba marcado como prueba
(CLAUDE.md §5). En el registro: cada llamada con `"ok":true` y su `"ms"`; ningún `"nivel":"error"`.

## G. Regreso a Apps Script (si algo sale mal) — [Gibran] [Leo]

**G1. [Gibran]** El servidor deja de escribir y lista lo que hay que llevar a Apps Script (sin secretos):
```bash
cd /srv/projects/capri/app/servidor
sudo sed -i 's/"soloLectura": false/"soloLectura": true/' /srv/capri/config/capri.json
sudo docker compose restart capri
sudo docker compose exec capri sh -c 'echo "{}" > /tmp/vacio.json && node herramientas/propiedades.js comparar /tmp/vacio.json /var/lib/capri/propiedades.json' | grep SESION_DESDE_
```
**G2. [Leo]** En Script Properties de Apps Script: agrega cada `SESION_DESDE_…` que listó G1 y **borra `API_MUDADA`**.

**G3. [Leo]** La interfaz de regreso:
```bash
perl -pi -e "s#const API_URL = 'https://capri\.helgen\.online/api';#const API_URL = 'https://script.google.com/macros/s/AKfycbwBjF7ra_4O8INsxBq0eh-4r-BlSsJ4LLxcJgVCPRpx1U1a-Pz1CUSdYtvj_Mh0S6y2/exec';#" web/cotizador/index.html
CLOUDFLARE_ACCOUNT_ID=badd8bca60b008822a73ca24e983ff43 npx --yes wrangler@4 deploy
git commit -am "Interfaz: API_URL de regreso a Apps Script" && git push
```
(Sin tocar el archivo: `CLOUDFLARE_ACCOUNT_ID=badd8bca60b008822a73ca24e983ff43 npx --yes wrangler@4 rollback`.)
[Verificar] CAPRI carga y guarda como antes; en el editor de Apps Script → Ejecuciones aparecen las llamadas.

## H. Día a día — [Gibran]

```bash
cd /srv/projects/capri/app/servidor
sudo docker compose exec capri node herramientas/admin.js salud            # detalle (solo desde dentro del contenedor)
sudo docker logs -f capri                                                  # registro (JSON por línea; rota a 5 × 10 MB)
sudo docker logs --since 1h capri 2>&1 | grep '"texto":"llamada"' | grep -E '"ms":[0-9]{4,}'   # llamadas de más de 1 s
sudo docker compose exec capri node herramientas/admin.js correr cadaQuinceMinutos   # como "Ejecutar" en el editor
sudo docker compose restart capri                                          # reinicio (5–15 s; la interfaz dice "se está actualizando")
sudo bash despliegue/nginx-capri.sh probar                                 # nginx y certificado
```
Actualizar a lo último de la rama (fuera de horario; como dueño del repositorio, **sin** sudo: el script lo pide para
docker si hace falta). Construye, corre las pruebas dentro de la imagen, cambia y revisa; si no queda sana, regresa sola:
```bash
cd /srv/projects/capri/app
servidor/despliegue/actualizar.sh servidor-etapa-1      # después del merge: servidor/despliegue/actualizar.sh main
servidor/despliegue/actualizar.sh --estado              # versión que corre e imágenes guardadas
servidor/despliegue/actualizar.sh --regresar            # a la imagen anterior (o: --regresar <etiqueta>)
```
Token revocado (`invalid_grant` en el registro): repetir C1–C4 solo para el token afectado y `sudo docker compose restart capri`.
