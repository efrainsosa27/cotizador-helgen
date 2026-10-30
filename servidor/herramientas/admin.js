#!/usr/bin/env node
// Administración del servicio DESDE DENTRO del contenedor (ahí 127.0.0.1 es el servicio mismo; desde el servidor o por
// nginx, /salud solo dice {"ok":true} y /admin/correr no existe):
//
//   docker compose exec capri node herramientas/admin.js salud                 detalle: trabajadores, libros, cuota, memoria
//   docker compose exec capri node herramientas/admin.js correr cadaQuinceMinutos [args JSON]   como "Ejecutar" en el editor
//   node herramientas/admin.js salud --callado      lo usa el HEALTHCHECK de la imagen: sale 0 si está sano, 1 si no
'use strict';

const puerto = Number(process.env.CAPRI_PUERTO || 8090);
const base = 'http://127.0.0.1:' + puerto;
const [, , accion, ...resto] = process.argv;
const callado = resto.includes('--callado');

async function salud() {
  let x;
  try {
    const r = await fetch(base + '/salud', { signal: AbortSignal.timeout(4000) });
    x = await r.json();
  } catch (e) {
    if (!callado) console.error('✘ CAPRI no contesta en ' + base + ': ' + e.message);
    return 1;
  }
  const trabajadores = (x.trabajadores && x.trabajadores.trabajadores) || [];
  const sano = x.ok === true && trabajadores.length > 0 && trabajadores.every(t => t.listo);
  if (!callado) {
    console.log(JSON.stringify(x, null, 1));
    console.log(sano ? '✔ sano' : '✘ no está sano (¿trabajadores sin cargar?)');
  }
  return sano ? 0 : 1;
}

async function correr(funcion, argsTexto) {
  if (!funcion) { console.error('Uso: admin.js correr <función> [args JSON, p. ej. \'["x", 1]\']'); return 2; }
  let args = [];
  if (argsTexto) {
    try { args = JSON.parse(argsTexto); } catch (e) { console.error('Los argumentos deben ser JSON: ' + e.message); return 2; }
  }
  const r = await fetch(base + '/admin/correr', { method: 'POST', body: JSON.stringify({ funcion, args }), signal: AbortSignal.timeout(330000) });
  const texto = await r.text();
  console.log(texto);
  try { return JSON.parse(texto).ok ? 0 : 1; } catch (e) { return 1; }
}

(async () => {
  if (accion === 'salud') return salud();
  if (accion === 'correr') return correr(resto[0], resto[1]);
  console.error('Uso: admin.js salud [--callado] | correr <función> [args JSON]');
  return 2;
})().then(c => process.exit(c), e => { console.error(e.message); process.exit(1); });
