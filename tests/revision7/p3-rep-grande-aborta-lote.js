// Copia de la revisión 7c (capri-7rev3/revision/) para la rama incremento-7-fix-importar: antes del arreglo esta prueba de concepto
// confirmaba el defecto; ahora comprueba lo corregido (la prueba permanente es tests/revision7-importar.test.js). Uso: bash tests/revision7/correr.sh
// P3 · Un solo complemento de pago grande tumba todo el envío y deja archivos huérfanos en Drive.
// filaFacturaCliente lanza "El CFDI trae demasiados pagos para guardarlo" (pagos JSON > MAX_JSON_CELDA) DENTRO de conCandado_,
// después de que los XML/PDF de TODO el lote ya se crearon en Drive. Resultado: la llamada falla entera (contra "un archivo malo no
// detiene a los demás"), ninguna factura se guarda, y los archivos privados creados no se mandan a la Papelera (`creados` se llena
// pero nunca se usa). Cada reintento crea otra copia.
// Uso: node revision/p3-rep-grande-aborta-lote.js
'use strict';
const assert = require('assert');
const C = require('./comun');
const A = C.crearArnes();

const I1 = C.cfdi({ uuid: C.U(1), folio: '101' });
// REP de Helgen que paga 400 facturas (pagos JSON ≈ 55 000 caracteres > 45 000); el XML pesa ~110 KB (< 2 MB)
const docs = Array.from({ length: 400 }, (_, i) => ({ uuid: C.U(5000 + i), ant: '100.00', pagado: '100.00', insoluto: '0.00', folio: String(i) }));
const P1 = C.cfdi({ tipo: 'P', uuid: C.U(900), serie: 'P', folio: '1', pagos: [{ fecha: '2026-10-20', monto: '40000.00', docs }] });
console.log('XML del REP:', Math.round(P1.length / 1024), 'KB');
const envio = () => A.post('tania', 'importarFacturasClientes', { archivos: [{ nombre: 'A-101.xml', datos: C.b64(I1) },
  { nombre: 'A-101.pdf', datos: A.PDF }, { nombre: 'REP-1.xml', datos: C.b64(P1) }], idSolicitud: 'mismo-envio' });

const huerfanos = () => Object.values(A.archivos).filter(a => a.blob && /Factura|Complemento/.test(a.blob.name) && !a.trashed).length;
for (let intento = 1; intento <= 2; intento++) {
  const r = envio();
  const filas = (A.libros[A.props.COBRANZA_DB_ID].pest.FacturasClientes || { m: [] }).m.length - 1;
  console.log('Intento', intento + ':', r.ok ? 'ok' : 'FALLA → ' + r.error, '· filas en FacturasClientes:', Math.max(0, filas),
    '· archivos de facturas vivos en Drive:', huerfanos());
  assert.equal(r.ok, true, 'ARREGLADO: el envío no se cae');
  assert(/demasiados pagos/.test(r.datos.resultados.find(x => x.archivo === 'REP-1.xml').mensaje), 'el REP se rechaza solo');
}
assert.equal(huerfanos(), 2, 'ARREGLADO: la factura y su PDF (del REP no se crea nada; el reintento no crea otra copia)');
console.log('ARREGLADO: el REP que no cabe se rechaza solo, la factura buena se guarda y nada queda huérfano.');

// Variante B: lo mismo con un texto de más de 50 000 caracteres en una celda normal (Nombre del receptor de 60 000). Sheets rechaza la
// celda (límite de 50 000 que el propio código cita en MAX_JSON_CELDA); aquí se simula ese límite en setValues/appendRow.
const B = C.crearArnes();
const escribe0 = B.ctx.escribe_;
const limite = v => { if (v.some(f => f.some(c => typeof c === 'string' && c.length > 50000))) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.'); };
B.ctx.escribe_ = hoja => { const h = escribe0(hoja);
  return Object.assign(Object.create(h), { appendRow: f => { limite([f]); return h.appendRow(f); },
    getRange: (...a) => { const r = h.getRange(...a); return Object.assign(Object.create(r), { setValues: v => { limite(v); return r.setValues(v); } }); } }); };
const rB = B.post('tania', 'importarFacturasClientes', { archivos: [{ nombre: 'A-101.xml', datos: C.b64(I1) },
  { nombre: 'A-102.xml', datos: C.b64(C.cfdi({ uuid: C.U(2), folio: '102', nombreReceptor: 'N'.repeat(60000) })) }], idSolicitud: 'b' });
const vivosB = Object.values(B.archivos).filter(a => a.blob && /Factura/.test(a.blob.name) && !a.trashed).length;
console.log('Variante B (nombre de 60 000 caracteres):', rB.ok ? 'ok' : 'FALLA → ' + rB.error, '· archivos huérfanos:', vivosB);
assert(rB.ok && rB.datos.conteos.importadas === 2 && vivosB === 2, 'ARREGLADO: el nombre se recorta al largo del SAT; las dos se guardan');
