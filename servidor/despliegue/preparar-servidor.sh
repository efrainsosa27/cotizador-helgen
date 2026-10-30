#!/usr/bin/env bash
# Preparación de una sola vez en el servidor (helgensrvr), con sudo. Idempotente: se puede volver a correr.
#   - usuario y grupo capri con UID/GID 10001 (el mismo de la imagen; es el dueño de config y datos)
#   - /srv/capri/config (700: capri.json y los tokens de Google, 600) y /srv/capri/datos (700: propiedades, caché, estado)
#   - /srv/capri/config/capri.json desde el ejemplo, en solo lectura (la primera corrida es la sombra, docs §12.1)
#   - construye la imagen y la etiqueta con el commit (servidor/.env: CAPRI_VERSION)
# NO arranca el servicio (faltan los tokens de Google y las propiedades) y NO toca nginx (despliegue/nginx-capri.sh).
# No instala Node en el servidor: todo corre dentro de la imagen.
#
# Uso:  sudo bash servidor/despliegue/preparar-servidor.sh [/srv/projects/capri/app]
set -euo pipefail
APP=${1:-/srv/projects/capri/app}
BASE=${CAPRI_BASE:-/srv/capri}
ID_CAPRI=10001
[ "$(id -u)" = 0 ] || { echo "Correr con sudo."; exit 1; }
[ -f "$APP/Code.js" ] && [ -f "$APP/servidor/Dockerfile" ] || { echo "No encuentro el repositorio en $APP (Code.js y servidor/Dockerfile)."; exit 1; }
command -v docker >/dev/null || { echo "Falta Docker."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Falta el plugin «docker compose» (paquete docker-compose-plugin)."; exit 1; }
case "$(uname -m)" in
  x86_64) ;;
  aarch64) echo "⚠ arm64: no hay Chrome for Testing; la imagen usará el chromium de Debian (PDF a revisar en el ensayo)." ;;
  *) echo "Arquitectura $(uname -m) no probada."; exit 1 ;;
esac

echo "== Usuario capri (UID/GID $ID_CAPRI)"
if id capri >/dev/null 2>&1; then
  [ "$(id -u capri)" = "$ID_CAPRI" ] || { echo "Ya existe un usuario capri con UID $(id -u capri), no $ID_CAPRI. Resolver a mano."; exit 1; }
else
  if getent passwd "$ID_CAPRI" >/dev/null; then echo "El UID $ID_CAPRI ya es de $(getent passwd "$ID_CAPRI" | cut -d: -f1). Construir con --build-arg CAPRI_UID=<otro> y ajustar este script."; exit 1; fi
  getent group "$ID_CAPRI" >/dev/null && { echo "El GID $ID_CAPRI ya es del grupo $(getent group "$ID_CAPRI" | cut -d: -f1)."; exit 1; }
  groupadd --system --gid "$ID_CAPRI" capri
  useradd --system --uid "$ID_CAPRI" --gid capri --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin capri
fi

echo "== Carpetas fuera de la imagen"
install -d -o root -g root -m 755 "$BASE"
install -d -o capri -g capri -m 700 "$BASE/config" "$BASE/datos"
if [ ! -f "$BASE/config/capri.json" ]; then
  install -o capri -g capri -m 600 "$APP/servidor/config.ejemplo.json" "$BASE/config/capri.json"
  echo "   $BASE/config/capri.json creado desde el ejemplo (soloLectura: true)"
fi
# Lo que alguien haya copiado a mano queda con dueño y permisos correctos (nunca legible por otros)
find "$BASE/config" "$BASE/datos" -type f -exec chown capri:capri {} + -exec chmod 600 {} +
ls -ln "$BASE" "$BASE/config" "$BASE/datos"

echo "== Imagen"
VERSION=$(git -c safe.directory="$APP" -C "$APP" rev-parse --short=12 HEAD)
cd "$APP/servidor"
CAPRI_VERSION="$VERSION" docker compose build
DUENO=$(stat -c %U "$APP")
{ echo "CAPRI_VERSION=$VERSION"; echo "CAPRI_CONFIG_DIR=$BASE/config"; echo "CAPRI_DATOS_DIR=$BASE/datos"; } > .env
chown "$DUENO" .env
echo "   capri:$VERSION construida (servidor/.env)"
BASE_IMG=$(sed -n 's/^ARG NODE_IMAGE=//p' Dockerfile)
echo "   imagen base: $(docker image inspect --format '{{index .RepoDigests 0}}' "${BASE_IMG%%@*}" 2>/dev/null || echo "$BASE_IMG")"
echo "   (para fijarla del todo, pon ese digest en ARG NODE_IMAGE del Dockerfile)"

echo
echo "Listo. Falta (docs/servidor-comandos.md): tokens de Google en $BASE/config, propiedades en $BASE/datos,"
echo "nginx (sudo bash servidor/despliegue/nginx-capri.sh certificado; … aplicar) y arrancar: cd $APP/servidor && docker compose up -d"
