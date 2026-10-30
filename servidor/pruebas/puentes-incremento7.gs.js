// Código de prueba con la forma de Apps Script: lo carga pruebas/puentes.test.js en un trabajador real (en lugar de
// Code.js) para recorrer, por el puente y el principal, lo que usa el incremento 7 (importar CFDI de clientes en ZIP y el
// recordatorio semanal desde el activador de 15 min). No es parte de CAPRI.

/** Drive: carpeta, archivo desde un Blob con bytes con signo, getBlob, moveTo, setTrashed. */
function pruebaDrive(xmlBase64) {
  const raiz = DriveApp.getRootFolder();
  const carpeta = raiz.createFolder('Incremento 7 — CFDI');
  const bytes = Utilities.base64Decode(xmlBase64); // Byte[] con signo
  const f = carpeta.createFile(Utilities.newBlob(bytes, 'application/xml', 'A1B2.xml'));
  const b = f.getBlob();
  const destino = raiz.createFolder('Procesados');
  f.moveTo(destino);
  const padre = DriveApp.getFileById(f.getId()).getParents().next().getId();
  f.setTrashed(true);
  return {
    blob: [b.getName(), b.getContentType(), b.getBytes().length, b.getDataAsString()],
    conSigno: b.getBytes().some(x => x < 0),
    movido: padre === destino.getId(),
    papelera: DriveApp.getFileById(f.getId()).isTrashed(),
  };
}

/** Utilities: base64, MD5 de texto y de Byte[], formatDate en la zona de México. */
function pruebaUtilities() {
  const d = new Date(Date.UTC(2026, 9, 29, 21, 30, 5)); // 15:30:05 en Querétaro
  return {
    b64: Utilities.base64Encode('Facturación ñ'),
    md5Texto: Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, 'UUID-ABC')),
    md5Bytes: Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, Utilities.newBlob('UUID-ABC').getBytes())),
    fechas: ['yyyy-MM-dd HH:mm', 'yyyy-MM-dd HH:mm:ss', 'yyyy-MM', 'HH'].map(p => Utilities.formatDate(d, 'America/Mexico_City', p)),
  };
}

/** Sheets: appendRow con fecha, apóstrofo y fórmula; deleteRows; getDataRange().getValues(); el límite de 50 000. */
function pruebaHojas(idLibro) {
  const h = SpreadsheetApp.openById(idLibro).getSheetByName('Cotizaciones');
  const candado = LockService.getScriptLock();
  candado.waitLock(10000);
  let largo = null;
  try {
    ['a', 'b', 'c', 'd'].forEach((x, i) => h.appendRow([x, i + 1]));
    h.appendRow(['e', '2026-10-20', "'0012", '=B1*2', '+52 442']);
    h.deleteRows(2, 2);
    try { h.getRange(10, 1).setValue('x'.repeat(50001)); } catch (e) { largo = e.message; }
  } finally {
    candado.releaseLock();
  }
  const v = h.getDataRange().getValues();
  return {
    valores: v.map(f => f.map(x => (x instanceof Date ? 'Date ' + Utilities.formatDate(x, 'America/Mexico_City', 'yyyy-MM-dd') : x))),
    formulas: h.getRange(3, 4, 1, 2).getFormulas()[0],
    largo,
    ultima: h.getLastRow(),
  };
}

/** Lo que quedó guardado (otra llamada: viene del espejo canónico, ya confirmado). */
function leerHojas(idLibro) {
  return SpreadsheetApp.openById(idLibro).getSheetByName('Cotizaciones').getDataRange().getValues()
    .map(f => f.map(x => (x instanceof Date ? 'Date' : x)));
}

/** Utilities.unzip dentro del trabajador, con el blob como lo manda la interfaz (base64). */
function pruebaUnzip(zipBase64) {
  return Utilities.unzip(Utilities.newBlob(Utilities.base64Decode(zipBase64), 'application/zip', 'cfdi.zip'))
    .map(b => [b.getName(), b.getBytes().length]);
}
