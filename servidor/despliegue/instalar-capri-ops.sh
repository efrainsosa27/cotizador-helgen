#!/bin/bash
# Ejecutar manualmente con sudo; no modifica Drogheda-ops ni sus llaves.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Ejecuta con sudo.'; exit 1; }
cd /srv/projects/capri/app
install -o root -g root -m 755 servidor/despliegue/capri-ops /usr/local/bin/capri-ops
archivo=$(mktemp)
trap 'rm -f "$archivo"' EXIT
printf 'leo ALL=(root) NOPASSWD: /usr/local/bin/capri-ops\n' > "$archivo"
/usr/sbin/visudo -cf "$archivo"
install -o root -g root -m 440 "$archivo" /etc/sudoers.d/capri-ops
/usr/sbin/visudo -c >/dev/null
echo 'Listo: ssh Drogheda sudo -n /usr/local/bin/capri-ops estado'
