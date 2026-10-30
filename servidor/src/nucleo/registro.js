// Registro en líneas JSON por la salida estándar (journald las guarda; Vector/Alloy las pueden mandar a Loki como las de
// htracker). Nunca se registran cuerpos de peticiones, tokens ni archivos.
'use strict';

function crearRegistro(o) {
  const op = o || {};
  const niveles = { depuracion: 0, info: 1, aviso: 2, error: 3 };
  const minimo = niveles[op.nivel || 'info'] || 1;
  const salida = op.salida || (linea => process.stdout.write(linea + '\n'));
  return function registro(nivel, texto, extra) {
    if ((niveles[nivel] == null ? 1 : niveles[nivel]) < minimo) return;
    salida(JSON.stringify(Object.assign({ t: new Date().toISOString(), nivel, texto }, extra || {})));
  };
}

module.exports = { crearRegistro };
