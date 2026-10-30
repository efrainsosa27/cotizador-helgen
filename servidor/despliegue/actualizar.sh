#!/usr/bin/env bash
# Actualiza CAPRI en el servidor: trae el código (git), construye la imagen nueva (etiqueta = commit), corre las pruebas
# del servidor DENTRO de esa imagen (sin Google ni red), cambia el contenedor y espera a que quede sano. Si algo falla
# antes del cambio, no se toca nada; si falla después, regresa solo a la imagen anterior (sigue en el servidor).
#
# Uso (como el dueño del repositorio; si no está en el grupo docker, usa sudo para docker):
#   servidor/despliegue/actualizar.sh [rama]                 por omisión: main
#   servidor/despliegue/actualizar.sh --regresar [etiqueta]  a la imagen anterior (o a esa etiqueta = commit corto)
#   servidor/despliegue/actualizar.sh --estado
# Cuándo: fuera de horario (el cambio deja ~5–15 s sin servicio: la interfaz muestra "CAPRI se está actualizando").
set -euo pipefail
# Este archivo vive en el repositorio y el git checkout de abajo lo cambia mientras bash lo lee: se corre una copia
YO=servidor/despliegue/actualizar.sh
if [ -z "${CAPRI_ACTUALIZAR_COPIA:-}" ]; then
  COPIA=$(mktemp "${TMPDIR:-/tmp}/capri-actualizar.XXXXXX")
  cp "$0" "$COPIA"
  CAPRI_ACTUALIZAR_COPIA="$COPIA" exec bash "$COPIA" "$@"
fi
trap 'rm -f "$CAPRI_ACTUALIZAR_COPIA"' EXIT
APP=${CAPRI_APP:-/srv/projects/capri/app}
cd "$APP/servidor"
[ -f .env ] || { echo "Falta servidor/.env: corre primero despliegue/preparar-servidor.sh."; exit 1; }
if docker info >/dev/null 2>&1; then SUDO=(); else SUDO=(sudo); fi
dk() { "${SUDO[@]}" docker "$@"; }
dc() { local v="$1"; shift; "${SUDO[@]}" env CAPRI_VERSION="$v" docker compose "$@"; }
ACTUAL=$(sed -n 's/^CAPRI_VERSION=//p' .env)

sano() {  # espera a que el contenedor corra la etiqueta $1 y su HEALTHCHECK diga healthy (máx. 2 min)
  local s img
  for _ in $(seq 1 120); do
    img=$(dk inspect -f '{{.Config.Image}}' capri 2>/dev/null || true)
    s=$(dk inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' capri 2>/dev/null || true)
    if [ "$img" = "capri:$1" ] && [ "$s" = healthy ]; then return 0; fi
    if [ "$img" = "capri:$1" ] && [ "$s" = unhealthy ]; then return 1; fi
    sleep 1
  done
  return 1
}
fijar() {  # deja $1 como la versión en servidor/.env (la que usa "docker compose up -d" sin nada más)
  sed -i "s/^CAPRI_VERSION=.*/CAPRI_VERSION=$1/" .env
}
cambiar_a() {  # etiqueta, motivo → contenedor con esa imagen; regresa 0 si quedó sano
  dc "$1" up -d --no-build --remove-orphans capri && sano "$1"
}
estado() {
  echo "versión en .env: $ACTUAL"
  dk ps -a --filter name=^capri$ --format 'contenedor: {{.Names}} · {{.Image}} · {{.Status}}'
  echo "imágenes (la primera es la más nueva):"; dk image ls capri --format '  {{.Tag}}  {{.CreatedSince}}  {{.Size}}'
}
podar() {  # se quedan las 5 imágenes más nuevas (y siempre la que corre); las de pruebas, solo la última
  local n=0 t
  while read -r t; do
    n=$((n+1)); [ "$n" -le 5 ] || [ "$t" = "$1" ] || dk image rm "capri:$t" >/dev/null 2>&1 || true
  done < <(dk image ls capri --format '{{.Tag}}' | grep -v '^<none>$')
  dk image ls capri-pruebas --format '{{.Tag}}' | grep -v "^$1$" | while read -r t; do dk image rm "capri-pruebas:$t" >/dev/null 2>&1 || true; done
}

case "${1:-}" in
  --estado) estado; exit 0 ;;
  --regresar)
    # Sin etiqueta: la imagen construida justo antes de la que corre (la lista viene de la más nueva a la más vieja)
    DESTINO=${2:-$(dk image ls capri --format '{{.Tag}}' | grep -v '^<none>$' | sed -n "/^$ACTUAL$/{n;p;q}")}
    [ -n "$DESTINO" ] || { echo "No hay otra imagen de capri en el servidor."; exit 1; }
    dk image inspect "capri:$DESTINO" >/dev/null 2>&1 || { echo "No existe la imagen capri:$DESTINO (mira: $YO --estado)."; exit 1; }
    echo "Regreso: capri:$ACTUAL → capri:$DESTINO"
    if cambiar_a "$DESTINO"; then
      fijar "$DESTINO"
      git checkout --quiet --detach "$DESTINO" 2>/dev/null || echo "(el código del repositorio no se movió: $DESTINO no es un commit)"
      echo "✔ CAPRI en capri:$DESTINO."; exit 0
    fi
    echo "✘ capri:$DESTINO no quedó sana; regreso a capri:$ACTUAL"; cambiar_a "$ACTUAL" || true; exit 1
    ;;
esac

RAMA=${1:-main}
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "✘ Hay cambios sin guardar en $APP: no se actualiza."; exit 1; }
ANTERIOR=$(git rev-parse HEAD)
volver_git() { echo "✘ $1: no se cambió nada; el repositorio regresa a ${ANTERIOR:0:12}."; git checkout --quiet --detach "$ANTERIOR"; exit 1; }

git fetch --quiet origin "$RAMA"
git checkout --quiet --detach "origin/$RAMA"
NUEVA=$(git rev-parse --short=12 HEAD)
if [ "$NUEVA" = "$ACTUAL" ] && sano "$ACTUAL"; then echo "Ya está en $NUEVA."; exit 0; fi
echo "CAPRI: $ACTUAL → $NUEVA"
git --no-pager log --oneline "$ANTERIOR..HEAD" | head -20

echo "== Construir y probar capri:$NUEVA (el servicio sigue con la anterior)"
dk build -f Dockerfile --target pruebas -t "capri-pruebas:$NUEVA" .. || volver_git "no se pudo construir"
dk run --rm --network none --read-only --tmpfs /tmp:size=256m,mode=1777 "capri-pruebas:$NUEVA" || volver_git "pruebas del servidor"
dc "$NUEVA" build capri || volver_git "no se pudo construir la imagen final"

echo "== Cambio"
if cambiar_a "$NUEVA"; then
  fijar "$NUEVA"
  podar "$NUEVA"
  echo "✔ CAPRI en capri:$NUEVA. Registro: docker logs -f capri   ·   regreso: $YO --regresar"
  exit 0
fi
echo "✘ capri:$NUEVA no quedó sana: regreso a capri:$ACTUAL"
dk logs --tail 40 capri 2>&1 | tail -40 || true
if cambiar_a "$ACTUAL"; then echo "✔ de vuelta en capri:$ACTUAL"; else echo "✘ tampoco quedó sana capri:$ACTUAL: docker logs capri"; fi
# La imagen que falló no se queda como candidata para --regresar
dk image rm "capri:$NUEVA" "capri-pruebas:$NUEVA" >/dev/null 2>&1 || true
git checkout --quiet --detach "$ANTERIOR"
exit 1
