#!/usr/bin/env node
// Confirma con Apps Script REAL la tabla de escritura del servidor (pruebas/casos-escritura.js): cómo guarda Sheets lo que
// Code.js escribe con setValues (número, fecha, apóstrofo, "+52…", fórmula, booleano; celda automática, "@" o de fecha).
//
//   node servidor/herramientas/paridad-escritura.js codigo > paridad.gs
//       imprime una función de Apps Script TEMPORAL (paridadEscrituraTemporal) con los mismos casos. Pegarla en un proyecto
//       de Apps Script cualquiera (p. ej. script.new con la cuenta de Leo; NO en el proyecto de la API), correrla, copiar la
//       línea JSON del registro de ejecución a resultado.json. Crea dos hojas de cálculo de prueba y las manda a la Papelera.
//   node servidor/herramientas/paridad-escritura.js comparar resultado.json
//       compara lo que guardó Apps Script con lo que guarda el servidor; sale 1 si algo difiere.
// Corre con Node en cualquier copia del repositorio (no necesita credenciales), o en la imagen de pruebas:
//   docker run --rm -i capri-pruebas:<versión> node herramientas/paridad-escritura.js comparar /dev/stdin < resultado.json
'use strict';
const fs = require('fs');
const path = require('path');
const { CASOS } = require(path.join(__dirname, '..', 'pruebas', 'casos-escritura.js'));

function codigo() {
  const casos = CASOS.map(c => ({ entrada: c.entrada, celda: c.celda || 'auto', locale: c.locale || 'es_MX' }));
  return `// TEMPORAL — paridad de escritura de CAPRI (servidor/herramientas/paridad-escritura.js). No guardar en el repositorio.
function paridadEscrituraTemporal() {
  var CASOS = ${JSON.stringify(casos)};
  var COLUMNA = { auto: 1, texto: 2, fecha: 3 };
  var libros = {}, salida = [];
  function libro(locale) {
    if (!libros[locale]) {
      var ss = SpreadsheetApp.create('CAPRI paridad de escritura ' + locale + ' (borrar)');
      ss.setSpreadsheetLocale(locale);
      ss.setSpreadsheetTimeZone('America/Mexico_City');
      var h = ss.getSheets()[0];
      h.getRange('B:B').setNumberFormat('@');
      h.getRange('C:C').setNumberFormat('dd/MM/yyyy HH:mm');
      libros[locale] = { ss: ss, h: h, fila: 0 };
    }
    return libros[locale];
  }
  try {
    CASOS.forEach(function (c) { var L = libro(c.locale); L.fila++; c.fila = L.fila; L.h.getRange(L.fila, COLUMNA[c.celda]).setValues([[c.entrada]]); });
    SpreadsheetApp.flush();
    CASOS.forEach(function (c) {
      var L = libro(c.locale), r = L.h.getRange(c.fila, COLUMNA[c.celda]);
      var v = r.getValue(), f = r.getFormula(), x;
      if (f) x = { tipo: 'formula', valor: f };
      else if (v instanceof Date) x = { tipo: 'fecha', valor: Utilities.formatDate(v, 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss') };
      else if (typeof v === 'number') x = { tipo: 'numero', valor: v };
      else if (typeof v === 'boolean') x = { tipo: 'booleano', valor: v };
      else if (v === '') x = { tipo: 'vacio', valor: '' };
      else x = { tipo: 'texto', valor: String(v) };
      x.formato = r.getNumberFormat(); x.visible = r.getDisplayValue(); x.locale = L.ss.getSpreadsheetLocale();
      salida.push(x);
    });
  } finally {
    Object.keys(libros).forEach(function (k) { DriveApp.getFileById(libros[k].ss.getId()).setTrashed(true); });
  }
  console.log(JSON.stringify({ apps: salida, anio: Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy') }));
}
`;
}

function comparar(archivo) {
  const texto = fs.readFileSync(archivo, 'utf8');
  const json = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
  if (!Array.isArray(json.apps) || json.apps.length !== CASOS.length) throw new Error('El resultado no corresponde a esta versión de la tabla (' + CASOS.length + ' casos).');
  let iguales = 0;
  const distintos = [];
  CASOS.forEach((c, i) => {
    const e = c.espera, a = json.apps[i];
    const valor = typeof e.valor === 'string' ? e.valor.replace('AAAA', json.anio) : e.valor;
    const igual = a.tipo === e.tipo && (a.valor === valor || (a.tipo === 'numero' && Math.abs(a.valor - valor) < 1e-9));
    if (igual) { iguales++; return; }
    distintos.push(JSON.stringify(c.entrada) + ' (' + (c.celda || 'auto') + ', ' + (c.locale || 'es_MX') + ', fuente: ' + c.fuente + ')\n' +
      '      servidor: ' + e.tipo + ' ' + JSON.stringify(valor) + '\n      Apps Script: ' + a.tipo + ' ' + JSON.stringify(a.valor) + ' (formato "' + a.formato + '", se ve "' + a.visible + '")');
  });
  console.log(iguales + ' de ' + CASOS.length + ' iguales');
  distintos.forEach(d => console.log('✘ ' + d));
  if (distintos.length) console.log('\nCorregir src/espejo/entrada.js y pruebas/casos-escritura.js hasta que todo salga igual.');
  return distintos.length ? 1 : 0;
}

if (require.main === module) {
  const [accion, archivo] = process.argv.slice(2);
  if (accion === 'codigo') process.stdout.write(codigo());
  else if (accion === 'comparar' && archivo) process.exit(comparar(archivo));
  else { console.error('Uso: paridad-escritura.js codigo | comparar resultado.json'); process.exit(2); }
}

module.exports = { codigo, comparar };
