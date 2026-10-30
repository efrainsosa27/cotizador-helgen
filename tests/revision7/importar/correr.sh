#!/bin/bash
# Corre las pruebas de concepto de la revisión 7c (ruta de importación de facturas de clientes) desde la raíz del repositorio.
# Uso: bash tests/revision7/importar/correr.sh   (p9 necesita playwright con Chromium; las capturas van a $CAPTURAS o al temporal del sistema)
cd "$(dirname "$0")/../../.." || exit 1
for p in tests/revision7/importar/p*.js; do
  echo "=== $(basename "$p")"
  node --expose-gc "$p" 2>&1 | grep -v '^\s*at ' | grep -v 'iniciarGis' | tail -12
done
