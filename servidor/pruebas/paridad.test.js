// Paridad: el mismo escenario (bootstrap → requisición → autorizar → pagar → recibir, con errores e idempotencia)
// corrido (A) con el arnés de siempre, directo sobre Code.js, y (B) por HTTP contra el servidor completo con el backend
// memoria (trabajadores, puente síncrono, fachada, espejo, diario y confirmación). Las respuestas deben ser idénticas,
// y también lo que quedó en las hojas, los archivos de Drive y los correos. Reporta la latencia en el proceso por llamada.
// Uso: node pruebas/paridad.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { REPO, fechaFija, tokensDeArnes, levantar, correrEscenario, diferencias } = require('./apoyo');
const { escenario, PROPS } = require('./escenario');
const crearArnes = require(path.join(REPO, 'tests', 'arnes.js'));

/** Hojas comparables: valores con fechas en ISO, sin columnas ni filas vacías al final, huecos como ''. */
function tablaDe(m) {
  const filas = m.map(f => {
    const x = Array.from({ length: (f || []).length }, (_, j) => {
      const v = f[j];
      if (v === undefined || v === null) return '';
      return v instanceof Date ? 'Date:' + v.toISOString() : v;
    });
    while (x.length && x[x.length - 1] === '') x.pop();
    return x;
  });
  while (filas.length && !filas[filas.length - 1].length) filas.pop();
  return filas;
}

(async () => {
  const T = Date.now();
  // ---------- A · arnés directo ----------
  const A = crearArnes(REPO, { props: PROPS, ctxExtra: { Date: fechaFija(T) } });
  const a = await correrEscenario(escenario(T), (quien, f, ...args) => A.post(quien, f, ...args));

  // ---------- B · servidor por HTTP ----------
  const B = await levantar({ props: PROPS, tokens: tokensDeArnes(A), relojFijo: T, trabajadores: 3 });
  const b = await correrEscenario(escenario(T), (quien, f, ...args) => B.post(quien, f, ...args));

  // ---------- Respuestas ----------
  assert.equal(a.pasos.length, b.pasos.length, 'mismo número de pasos');
  let distintas = 0;
  // Las versiones son hora + 6 cifras al azar desde el incremento 6 (versionNueva_; solo se comparan por igualdad): aquí se
  // compara que estén las mismas colecciones y cuáles van ocultas (VERSION_OCULTA = 0), no el número
  const sinVersiones = x => JSON.parse(JSON.stringify(x), (k, v) => (k === 'versiones' && v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(c => [c, v[c] === 0 ? 0 : typeof v[c]])) : v));
  a.pasos.forEach((pa, i) => {
    const pb = b.pasos[i];
    const d = diferencias(sinVersiones(pa.r), sinVersiones(pb.r));
    if (d.length) { distintas++; console.log('✘ paso ' + (i + 1) + ' «' + pa.paso + '» (' + pa.funcion + '):\n   ' + d.slice(0, 8).join('\n   ')); }
  });
  assert.equal(distintas, 0, distintas + ' respuesta(s) distinta(s)');
  assert.deepEqual(a.resultado, b.resultado, 'folios del escenario');
  const conError = a.pasos.filter(p => !p.r.ok).length;

  // ---------- Hojas, Drive y correos ----------
  const librosA = Object.keys(A.libros).sort(), librosB = [...B.conductor.libros.keys()].sort();
  assert.deepEqual(librosB, librosA, 'mismos libros');
  // Diferencia conocida: el arnés no tiene Sheet.getParent ni setFormula, así que asegurarPrecioUsd_ falla ahí (Code.js
  // lo atrapa: "el catálogo funciona igual") y en el servidor no (como en Apps Script: el catálogo real ya tiene la pestaña
  // "Tipo de cambio" y la columna I con fórmula, §9). Se revisa aparte y lo demás debe ser idéntico.
  const cat = B.conductor.libros.get('CAT');
  const tc = cat.hojas.find(h => h.titulo === 'Tipo de cambio');
  assert(tc && tc.formulas['1,1'] === '=GOOGLEFINANCE("CURRENCY:USDMXN")' && /ISNUMBER\(B3\)/.test(tc.formulas['3,1']), 'pestaña Tipo de cambio con sus fórmulas');
  const catalogoB = cat.hojas.find(h => h.titulo === 'Catalogo');
  assert(/^=IF\(ISNUMBER\(D2\)/.test(catalogoB.formulas['1,8']) && /Precio USD/.test(catalogoB.valores[0][8]), 'columna I del catálogo con fórmula');
  librosA.forEach(id => {
    const pa = A.libros[id].pest, lb = B.conductor.libros.get(id);
    const hojasB = lb.hojas.filter(h => !(id === 'CAT' && h.titulo === 'Tipo de cambio'));
    assert.deepEqual(hojasB.map(h => h.titulo).sort(), Object.keys(pa).sort(), 'mismas pestañas en ' + id);
    hojasB.forEach(h => {
      const recorte = t => (id === 'CAT' && h.titulo === 'Catalogo' ? t.map(f => f.slice(0, 8)) : t);
      const d = diferencias(recorte(tablaDe(pa[h.titulo].m)), recorte(tablaDe(h.valores)));
      assert.equal(d.length, 0, 'hoja ' + id + '/' + h.titulo + ': ' + d.slice(0, 5).join(' · '));
    });
  });
  const archivosA = Object.values(A.archivos).filter(x => x.blob).map(x => [x.id, x.nombre || x.blob.name, x.padre.id]).sort();
  const archivosB = [...B.conductor.items.values()].filter(x => !x.carpeta && !x.libro).map(x => [x.id, x.nombre, x.padre]).sort();
  assert.deepEqual(archivosB, archivosA, 'mismos archivos en Drive (id, nombre, carpeta)');
  const carpetasA = Object.values(A.carpetas).map(x => [x.id, x.nombre, x.padre ? x.padre.id : null, x.acceso]).sort();
  const carpetasB = [...B.conductor.items.values()].filter(x => x.carpeta).map(x => [x.id, x.nombre, x.padre, x.acceso]).sort();
  assert.deepEqual(carpetasB, carpetasA, 'mismas carpetas y mismo acceso (privado_)');
  const correosA = A.correos.map(m => [m.to, m.subject, m.body, m.htmlBody, m.name, m.replyTo || null]);
  const correosB = B.conductor.correos.map(m => [m.para, m.asunto, m.texto, m.html, m.nombre, m.responderA]);
  assert.deepEqual(correosB, correosA, 'mismos correos');

  // ---------- Latencia en el proceso ----------
  console.log('Paridad: ' + a.pasos.length + ' llamadas idénticas (' + conError + ' con error esperado), ' + librosA.length +
    ' libros, ' + archivosA.length + ' archivos, ' + carpetasA.length + ' carpetas y ' + correosA.length + ' correos iguales.');
  const llamadas = B.lineas.filter(l => l.texto === 'llamada');
  console.log('\nLatencia en el proceso (backend memoria, sin red; ms):');
  console.log('  paso'.padEnd(46) + 'arnés  HTTP total  trabajo  CPU  confirm.  rpc');
  b.pasos.forEach((p, i) => {
    const l = llamadas[i] || {};
    const rpc = Object.keys(l.rpc || {}).map(k => k + ':' + l.rpc[k].n + (process.env.DETALLE ? '/' + Math.round(l.rpc[k].ms) + 'ms' : '')).join(' ');
    console.log('  ' + (String(i + 1).padStart(2) + ' ' + p.paso).slice(0, 43).padEnd(44) + a.pasos[i].ms.toFixed(1).padStart(6) +
      p.ms.toFixed(1).padStart(11) + String(l.msTrabajo == null ? '' : l.msTrabajo).padStart(9) + String(l.cpuMs == null ? '' : l.cpuMs).padStart(5) +
      String(l.confirmaciones == null ? '' : l.confirmaciones).padStart(9) + '  ' + rpc);
  });
  const total = x => x.reduce((s, p) => s + p.ms, 0);
  console.log('  total: arnés ' + total(a.pasos).toFixed(0) + ' ms · servidor ' + total(b.pasos).toFixed(0) + ' ms');
  await B.cerrar();
  console.log('✔ paridad');
})().catch(e => { console.error(e); process.exit(1); });
