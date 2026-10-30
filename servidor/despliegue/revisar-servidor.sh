#!/usr/bin/env bash
# Revisión del servidor (helgensrvr) antes de instalar CAPRI en Docker. Solo lee: no instala ni cambia nada.
# Uso: sudo bash servidor/despliegue/revisar-servidor.sh 2>&1 | tee revision-servidor.txt
#      (sin sudo también corre, pero no ve puertos con proceso, firewall ni certificados)
set -u
seccion() { printf '\n== %s\n' "$1"; }

seccion "Sistema"
uname -a
grep PRETTY_NAME /etc/os-release
echo "Arquitectura: $(uname -m)  (x86_64 = Chrome for Testing en la imagen; aarch64 = chromium de Debian)"
echo "CPU: $(nproc)"
free -h
df -h /srv /var/lib/docker /tmp 2>/dev/null

seccion "Hora (Code.js trabaja en America/Mexico_City; el contenedor la fija con TZ)"
timedatectl 2>/dev/null | grep -E 'Time zone|System clock synchronized|NTP service' || date

seccion "Docker"
docker version --format 'cliente {{.Client.Version}} · servidor {{.Server.Version}}' 2>&1 | head -2
docker compose version 2>&1 | head -1
docker info --format 'almacenamiento {{.Driver}} · cgroup {{.CgroupDriver}} v{{.CgroupVersion}} · raíz {{.DockerRootDir}} · contenedores {{.Containers}}' 2>&1 | head -1
systemctl is-enabled docker 2>/dev/null | sed 's/^/docker al arrancar el servidor: /'
id -nG "${SUDO_USER:-$USER}" | grep -qw docker && echo "${SUDO_USER:-$USER} está en el grupo docker" || echo "${SUDO_USER:-$USER} NO está en el grupo docker (usará sudo docker)"

seccion "nginx y certbot"
nginx -v 2>&1
certbot --version 2>/dev/null || echo "sin certbot"
ls -l /etc/nginx/sites-enabled 2>/dev/null
grep -l 'capri.helgen.online' /etc/nginx/sites-enabled/* 2>/dev/null && echo "⚠ ya hay un sitio con capri.helgen.online" || echo "ningún sitio habilitado usa capri.helgen.online (bien)"
ls /etc/letsencrypt/options-ssl-nginx.conf /etc/letsencrypt/ssl-dhparams.pem 2>&1
ls /etc/letsencrypt/live 2>&1
systemctl list-timers 'certbot*' --no-pager 2>/dev/null | head -3
systemctl is-active nginx actas-hbox 2>/dev/null | paste -sd' ' -

seccion "Puertos (CAPRI publicará solo 127.0.0.1:8090)"
ss -ltnp 2>/dev/null | grep -E ':(80|443|8081|8090)\b' || echo "(nada en esos puertos o ss sin permisos)"

seccion "Firewall"
ufw status 2>/dev/null | head -12 || echo "(sin ufw o sin sudo)"

seccion "DNS"
getent hosts capri.helgen.online drogheda.helgen.online || true
ip -4 -brief addr 2>/dev/null | grep -v '^lo' | head -5

seccion "Salida a Internet (debe dar un código HTTP rápido, nunca 000)"
for u in https://sheets.googleapis.com/ https://www.googleapis.com/ https://oauth2.googleapis.com/ https://gmail.googleapis.com/ \
         https://registry-1.docker.io/v2/ https://registry.npmjs.org/ https://storage.googleapis.com/chrome-for-testing-public/ \
         https://deb.debian.org/debian/; do
  curl -s -o /dev/null -m 10 -w "%{http_code}  %{time_total}s  $u\n" "$u" || echo "000  SIN SALIDA  $u"
done
echo "-- el centro de mando por su nombre público (desde el contenedor se usará la puerta del servidor: extra_hosts)"
curl -s -o /dev/null -m 10 -w "%{http_code}  %{time_total}s  https://drogheda.helgen.online/api/salud\n" https://drogheda.helgen.online/api/salud || echo "sin respuesta"

seccion "Usuario y carpetas de CAPRI (UID/GID 10001; antes de instalar no deben existir)"
id capri 2>/dev/null || echo "sin usuario capri"
getent passwd 10001 || echo "UID 10001 libre"
getent group 10001 || echo "GID 10001 libre"
ls -ld /srv/projects /srv/projects/capri /srv/capri /srv/capri/config /srv/capri/datos 2>&1
docker ps -a --filter name=^capri$ --format 'contenedor capri: {{.Image}} · {{.Status}}' 2>/dev/null
