#!/usr/bin/env bash
# Revisión del servidor (git.helgen.online) antes de instalar CAPRI. Solo lee: no instala ni cambia nada.
# Uso: bash revisar-servidor.sh 2>&1 | tee revision-servidor.txt   (y mandar el archivo a quien instala)
set -u
seccion() { printf '\n== %s\n' "$1"; }

seccion "Sistema"
uname -a
lsb_release -d 2>/dev/null || grep PRETTY_NAME /etc/os-release
echo "CPU: $(nproc)"
free -h
df -h /srv /var /tmp 2>/dev/null

seccion "Hora (Code.js trabaja en America/Mexico_City)"
timedatectl 2>/dev/null | grep -E 'Time zone|System clock synchronized|NTP service' || date

seccion "Node, npm y Docker (Docker es opcional)"
node -v 2>/dev/null || echo "sin node"
npm -v 2>/dev/null || echo "sin npm"
docker -v 2>/dev/null || echo "sin docker"

seccion "nginx y certbot"
nginx -v 2>&1
certbot --version 2>/dev/null || echo "sin certbot"
ls -1 /etc/nginx/sites-enabled 2>/dev/null
systemctl is-active nginx actas-hbox 2>/dev/null | paste -sd' ' -

seccion "Puertos en uso (CAPRI usará 127.0.0.1:8090)"
ss -ltnp 2>/dev/null | grep -E ':(80|443|8081|8090)\b' || echo "(ss sin permisos: correr con sudo para ver procesos)"

seccion "Librerías de Chromium y fuentes (para los PDF)"
for p in libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
         libxrandr2 libgbm1 libpango-1.0-0 libcairo2 fonts-liberation fonts-dejavu-core; do
  dpkg -s "$p" >/dev/null 2>&1 && echo "ok     $p" || echo "FALTA  $p"
done
(dpkg -s libasound2 >/dev/null 2>&1 || dpkg -s libasound2t64 >/dev/null 2>&1) && echo "ok     libasound2" || echo "FALTA  libasound2 (o libasound2t64)"
sysctl kernel.unprivileged_userns_clone 2>/dev/null || true
sysctl kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || true

seccion "Salida a Google (debe dar 404 o 200 rápido, nunca 000)"
for h in sheets.googleapis.com www.googleapis.com oauth2.googleapis.com gmail.googleapis.com; do
  curl -s -o /dev/null -m 10 -w "$h  HTTP %{http_code}  %{time_total}s\n" "https://$h/" || echo "$h  SIN SALIDA"
done

seccion "DNS"
getent hosts git.helgen.online drogheda.helgen.online capri.helgen.online || echo "capri.helgen.online todavía no existe (normal antes del alta)"

seccion "Usuario y carpetas de CAPRI (no deben existir antes de instalar)"
id capri 2>/dev/null || echo "sin usuario capri"
ls -ld /srv/projects /srv/projects/capri /var/lib/capri /etc/capri /opt/capri 2>&1
