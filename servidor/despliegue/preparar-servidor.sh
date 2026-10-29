#!/usr/bin/env bash
# Preparación de una sola vez en el servidor (Debian/Ubuntu), con sudo. Idempotente: se puede volver a correr.
# Crea el usuario capri, las carpetas, instala librerías y fuentes para Chromium, Chromium sin interfaz (Chrome for
# Testing, headless shell) en /opt/capri/chrome y el servicio de systemd. NO instala Node (ver docs §10) ni toca nginx.
#
# Uso:  sudo bash servidor/despliegue/preparar-servidor.sh /srv/projects/capri/app
set -euo pipefail
APP=${1:-/srv/projects/capri/app}
[ "$(id -u)" = 0 ] || { echo "Correr con sudo."; exit 1; }
command -v node >/dev/null || { echo "Falta Node 20 o 22 (ver docs/servidor-etapa-1.md §10)."; exit 1; }
MAYOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$MAYOR" -ge 20 ] || { echo "Node $MAYOR es muy viejo: se necesita 20 o más."; exit 1; }
[ -f "$APP/Code.js" ] && [ -d "$APP/servidor" ] || { echo "No encuentro el repositorio en $APP (Code.js y servidor/)."; exit 1; }

echo "== Usuario y carpetas"
id capri >/dev/null 2>&1 || useradd --system --home-dir /var/lib/capri --shell /usr/sbin/nologin capri
install -d -o capri -g capri -m 700 /var/lib/capri
install -d -o root -g capri -m 750 /etc/capri
install -d -o root -g root -m 755 /opt/capri

echo "== Librerías y fuentes para Chromium (apt)"
apt-get update -qq
LIBASOUND=libasound2; apt-cache show libasound2t64 >/dev/null 2>&1 && LIBASOUND=libasound2t64
apt-get install -y -qq --no-install-recommends ca-certificates libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 "$LIBASOUND" \
  fonts-liberation fonts-dejavu-core >/dev/null

echo "== Chromium sin interfaz en /opt/capri/chrome"
if [ ! -x /opt/capri/chrome/chrome-headless-shell ]; then
  TMP=$(mktemp -d)
  (cd "$TMP" && npx --yes @puppeteer/browsers@2.10.5 install chrome-headless-shell@stable --path "$TMP/b" >/dev/null)
  BIN=$(find "$TMP/b" -type f -name chrome-headless-shell | head -1)
  rm -rf /opt/capri/chrome && mkdir -p /opt/capri/chrome && cp -a "$(dirname "$BIN")/." /opt/capri/chrome/
  rm -rf "$TMP"
fi
/opt/capri/chrome/chrome-headless-shell --version || echo "⚠ Chromium no arranca: revisar librerías (ldd /opt/capri/chrome/chrome-headless-shell | grep 'not found')"

echo "== Dependencias de Node del servidor"
(cd "$APP/servidor" && sudo -u "$(stat -c %U "$APP")" npm ci --omit=dev --no-audit --no-fund)

echo "== Configuración"
[ -f /etc/capri/capri.json ] || { install -o root -g capri -m 640 "$APP/servidor/config.ejemplo.json" /etc/capri/capri.json; echo "   /etc/capri/capri.json creado desde el ejemplo: revisarlo (google.credenciales, origenes, soloLectura)"; }

echo "== Servicio systemd (no se arranca todavía)"
install -o root -g root -m 644 "$APP/servidor/despliegue/capri.service" /etc/systemd/system/capri.service
sed -i "s#/srv/projects/capri/app#$APP#g" /etc/systemd/system/capri.service
systemctl daemon-reload
systemctl enable capri >/dev/null

echo
echo "Listo. Falta (docs §10): credenciales de Google en /etc/capri/, propiedades en /var/lib/capri/propiedades.json,"
echo "nginx + certbot para capri.helgen.online y arrancar con: sudo systemctl start capri && curl -s 127.0.0.1:8090/salud"
