#!/usr/bin/env bash
# Actualiza CAPRI en el servidor: trae el código (git), instala dependencias, corre las pruebas (sin Google), reinicia y
# revisa la salud. Si algo falla antes o después del reinicio, regresa solo a la versión anterior.
#
# Uso (en el servidor, como el dueño del repositorio, con sudo para systemctl):
#   /srv/projects/capri/app/servidor/despliegue/actualizar.sh [rama]      (por omisión: main)
# Cuándo: fuera de horario (el reinicio deja ~5–15 s sin servicio: la interfaz muestra "CAPRI se está actualizando").
set -euo pipefail
APP=${CAPRI_APP:-/srv/projects/capri/app}
RAMA=${1:-main}
SALUD=http://127.0.0.1:8090/salud
cd "$APP"
[ -z "$(git status --porcelain)" ] || { echo "✘ Hay cambios sin guardar en $APP: no se actualiza."; exit 1; }
ANTERIOR=$(git rev-parse HEAD)

instalar() { (cd servidor && npm ci --omit=dev --no-audit --no-fund >/dev/null); }
sano() {
  for _ in $(seq 1 60); do
    if curl -fsS -m 2 "$SALUD" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);process.exit(x.ok&&x.trabajadores.trabajadores.every(t=>t.listo)?0:1)})'; then return 0; fi
    sleep 1
  done
  return 1
}
regresar() {
  echo "✘ $1: regreso a ${ANTERIOR:0:10}"
  git checkout --quiet --detach "$ANTERIOR"
  instalar
  sudo systemctl restart capri
  sano && echo "✔ de vuelta en ${ANTERIOR:0:10}" || echo "✘ tampoco arrancó la anterior: journalctl -u capri -n 100"
  exit 1
}

git fetch --quiet origin "$RAMA"
git checkout --quiet --detach "origin/$RAMA"
NUEVA=$(git rev-parse HEAD)
[ "$NUEVA" != "$ANTERIOR" ] || { echo "Ya está en ${NUEVA:0:10}."; exit 0; }
echo "CAPRI: ${ANTERIOR:0:10} → ${NUEVA:0:10}"
git --no-pager log --oneline "$ANTERIOR..$NUEVA" | head -20

instalar || regresar "npm ci"
node --check Code.js || regresar "sintaxis de Code.js"
(cd servidor && node pruebas/todas.js) || regresar "pruebas del servidor"
sudo systemctl restart capri
sano || regresar "el servicio no quedó sano"
echo "✔ CAPRI en ${NUEVA:0:10}. Revisa: journalctl -u capri -f -o cat"
