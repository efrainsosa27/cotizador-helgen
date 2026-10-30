#!/bin/bash
# Corre las sondas de la revisión del incremento 7 (dinero, monedas y estados). Cada una TERMINA EN ERROR mientras el defecto exista
# (copiadas de la revisión independiente; p3 y p5 se adaptaron al comportamiento corregido, y las r3-* de la tercera revisión se
# invirtieron: antes confirmaban el defecto). La prueba permanente es tests/revision7-dinero.test.js.
# Uso (desde la raíz del repositorio): bash tests/revision7/correr.sh
cd "$(dirname "$0")/../.." || exit 1
fallas=0
for s in p1-adicional-anulada-saldo p2-uuid-gasto-y-factura-proveedor p3-liga-por-orden-de-etapa "p4-idempotencia-pago . 140" \
  p5-moneda-cambia-con-gastos p6-rep-usd-pagado-en-mxn r3-p5-uuid-gasto-luego-factura-proveedor r3-p11-rep-sustituido; do
  set -- $s; f=$1; shift
  out=$(node "tests/revision7/$f.js" ${@:-.} 2>&1)
  if [ $? -eq 0 ]; then echo "✔ $f (ya no reproduce)"; else fallas=1; echo "✘ $f"; echo "$out" | grep -v '^\s*at \|^node:\|^Node\|^ *\^\|throw \|^$\|generatedMessage\|code:\|actual:\|expected:\|operator:\|diff:\|^}' | sed 's/^/    /'; fi
done
node -e "const A=require('./tests/arnes')('.',{});const v=A.P.importeDeTexto('45.000');console.log((v===45?'✘':'✔')+' importeDeTexto(\"45.000\") = '+v+' (CSV de costos: 45 MXN en lugar de 45,000)');process.exit(v===45?1:0)" || fallas=1
exit $fallas
