// Puentes que usa el incremento 7, de punta a punta en un trabajador real (puente síncrono → principal → Drive y Sheets
// simulados): Drive (createFile con Blob de bytes con signo, getBlob, moveTo, setTrashed), Utilities (base64, MD5,
// formatDate, unzip), Sheets (deleteRows, getDataRange, fecha/apóstrofo/fórmula, límite de 50 000 caracteres) y el
// activador de 15 minutos declarado en la configuración.
// Uso: node pruebas/puentes.test.js
'use strict';
process.env.TZ = 'America/Mexico_City';
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { levantar, REPO } = require('./apoyo');

const casos = [];
const caso = (n, f) => casos.push([n, f]);
const PRUEBA = path.join(__dirname, 'puentes-incremento7.gs.js');
const correr = async (B, funcion, ...args) => {
  const r = JSON.parse((await B.servicio.correrFuncion(funcion, args)).texto);
  assert(r.ok, funcion + ': ' + r.error);
  return r.datos;
};

caso('Drive, Utilities, Sheets y unzip por el puente (lo que llama el incremento 7)', async () => {
  const B = await levantar({ trabajadores: 2, conf: { codigo: { dir: REPO, archivos: [path.join(REPO, 'Logo.js'), PRUEBA] } } });
  try {
    const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante Total="1160.00">ÿ</cfdi:Comprobante>', 'latin1');
    const d = await correr(B, 'pruebaDrive', xml.toString('base64'));
    assert.deepEqual(d.blob, ['A1B2.xml', 'application/xml', xml.length, xml.toString('utf8')]);
    assert.equal(d.conSigno, true, 'getBytes() con signo');
    assert.equal(d.movido, true, 'moveTo');
    assert.equal(d.papelera, true, 'setTrashed(true)');

    const u = await correr(B, 'pruebaUtilities');
    assert.equal(u.b64, Buffer.from('Facturación ñ').toString('base64'));
    const md5 = crypto.createHash('md5').update('UUID-ABC').digest('base64').replace(/\+/g, '-').replace(/\//g, '_');
    assert.equal(u.md5Texto, md5);
    assert.equal(u.md5Bytes, md5, 'MD5 de Byte[] = MD5 del texto');
    assert.deepEqual(u.fechas, ['2026-10-29 15:30', '2026-10-29 15:30:05', '2026-10', '15']);

    const h = await correr(B, 'pruebaHojas', 'DB');
    assert.deepEqual(h.valores, [['a', 1, '', '', ''], ['d', 4, '', '', ''], ['e', 'Date 2026-10-20', '0012', '', '+52 442']],
      'deleteRows(2, 2) quitó b y c; la fecha ISO es Date; el apóstrofo deja texto; "+52 442" queda texto (medido); las fórmulas valen lo que calcule Sheets');
    assert.deepEqual(h.formulas, ['=B1*2', ''], 'solo "=" hace fórmula; "+52 442" es texto y no tiene fórmula (medido)');
    assert.equal(h.largo, 'Your input contains more than the maximum of 50000 characters in a single cell.');
    assert.equal(h.ultima, 3, 'el texto de 50 001 no se escribió');
    assert.deepEqual(await correr(B, 'leerHojas', 'DB'), [['a', 1, '', '', ''], ['d', 4, '', '', ''], ['e', 'Date', '0012', '', '+52 442']],
      'confirmado al soltar el candado: otra llamada lo lee del espejo canónico');
    const filas = B.conductor.libros.get('DB').hojas.find(x => x.titulo === 'Cotizaciones').valores;
    assert.equal(filas.length, 3, 'y llegó a "Google" (el backend en memoria) con las filas ya borradas');

    // Un ZIP de Python con carpeta (ver unidades.test.js)
    const zip = 'UEsDBBQAAAAAAAAAIQAAAAAAAAAAAAAAAAAFAAAAQ0ZESS9QSwMEFAAACAgA4JNdXd+gbUFSAAAAPAUAABgAAABDRkRJL0ZhY3R1cmFjacOzbiDDsS54bWyzsa/IzVEoSy0qzszPs1Uy1DNQsrezSU5LybRyzs8tKMpPSswrSVUIyS9JzLFVMjQ0M9AzMFBSCA31dLFVcnRyVtK3sxk1YtSIUSNGjRhpRgAAUEsDBBQAAAAAAOCTXV2I+aBvBAAAAAQAAAAJAAAAbGVlbWUudHh0aG9sYVBLAQIUAxQAAAAAAAAAIQAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAACAAQAAAABDRkRJL1BLAQIUAxQAAAgIAOCTXV3foG1BUgAAADwFAAAYAAAAAAAAAAAAAACAASMAAABDRkRJL0ZhY3R1cmFjacOzbiDDsS54bWxQSwECFAMUAAAAAADgk11diPmgbwQAAAAEAAAACQAAAAAAAAAAAAAAgAGrAAAAbGVlbWUudHh0UEsFBgAAAAADAAMAsAAAANYAAAAAAA==';
    assert.deepEqual(await correr(B, 'pruebaUnzip', zip), [['CFDI/', 0], ['CFDI/Facturación ñ.xml', 1340], ['leeme.txt', 4]]);
  } finally {
    await B.cerrar();
  }
});

caso('el activador de 15 minutos: declarado en la configuración, se crea al arrancar (sin el editor) y se corre como trabajo', async () => {
  const conf = require('../config.ejemplo.json');
  assert.deepEqual(conf.activadoresFijos, [{ funcion: 'cadaQuinceMinutos', cadaMinutos: 15 }], 'config.ejemplo.json lo declara');
  const B = await levantar({ trabajadores: 1, conf: { activadoresFijos: conf.activadoresFijos } });
  try {
    assert.deepEqual(B.servicio.activadores.listar().map(a => [a.funcion, a.cadaMinutos]), [['cadaQuinceMinutos', 15]]);
    const r = JSON.parse((await B.servicio.activadores.ejecutar('cadaQuinceMinutos')).texto);
    assert.equal(r.ok, true, 'Code.js corre cadaQuinceMinutos (ahí irá el recordatorio semanal)');
  } finally {
    await B.cerrar();
  }
});

(async () => {
  let fallas = 0;
  for (const [n, f] of casos) {
    try { await f(); console.log('✔ ' + n); } catch (e) { fallas++; console.log('✘ ' + n + '\n   ' + String(e && e.stack || e).split('\n').slice(0, 8).join('\n   ')); }
  }
  if (fallas) { console.log(fallas + ' prueba(s) fallaron'); process.exit(1); }
})();
