#!/bin/bash
# Corre todas las pruebas en Node (menos sat, que necesita la carpeta de Drive) y revisa la sintaxis del JS de la interfaz.
# Uso (desde la carpeta del repositorio): bash tests/todas.sh
cd "$(dirname "$0")/.." || exit 1
mkdir -p /tmp/salida-pdf
fallas=0
for t in tests/*.test.js; do
  n=$(basename "$t" .test.js)
  [ "$n" = sat ] && continue
  if [ "$n" = cotizacion ]; then out=$(node "$t" Code.js /tmp/salida-pdf 2>&1); else out=$(node "$t" . 2>&1); fi
  if [ $? -eq 0 ]; then echo "✔ $n"; else echo "✘ $n"; echo "$out" | grep -v '^    at ' | head -25; fallas=1; fi
done
tmp=$(mktemp -d)
python3 - "$tmp/ui.js" <<'PY'
import re, sys
s = open('web/cotizador/index.html', encoding='utf8').read()
open(sys.argv[1], 'w', encoding='utf8').write('\n;\n'.join(re.findall(r'<script(?: id="[^"]*")?>(.*?)</script>', s, re.S)))
PY
if node --check "$tmp/ui.js" 2>"$tmp/err"; then echo "✔ sintaxis de la interfaz"; else echo "✘ sintaxis de la interfaz"; head -8 "$tmp/err"; fallas=1; fi
node --check Code.js || fallas=1
rm -rf "$tmp"
# Servidor propio (etapa 1): solo si ya se instalaron sus dependencias (cd servidor && npm ci)
if [ -d servidor/node_modules ]; then node servidor/pruebas/todas.js || fallas=1; fi
exit $fallas
