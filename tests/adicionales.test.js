// Incremento 7 · módulo A (Adicionales): cotización "Adicional" en un proyecto con contrato firmado, su mini-esquema y su cobro.
// Contrato: docs/incremento-7.md (§0, §1 adicionalesPorProyecto, §2 A, §3); detalle: docs/incremento-7-adicionales.md.
//  0. Regresión: proyectos sin adicionales dan exactamente las cifras de antes (tests/adicionales-regresion.json, guardado con el
//     código de incremento-7-base) en funciones puras, vista, resumen, CxC y flujo.
//  1. Lógica pura: tipo, regla de cotizar, aceptar, claves y etiquetas de etapas, resumenCobranza con adicionales (reparto,
//     excedente, tolerancia, etapa elegida, adicional que ya no está), etapasPorCobrar / CxC / flujo con sus etapas, resumen
//     general, fechas esperadas por esquema y adicionalesPorProyecto (contrato §1).
//  2. Servidor por doPost: la regla del contrato firmado en los dos sentidos, moneda, PDF, columna tipo, lista de proyectos para
//     ventas, aceptar / esquema / fechas / cancelar con sus permisos, pagos repartidos entre contrato y adicionales, tolerancia,
//     desbloqueo que no toca las adicionales, resumen, CxC y flujo, y las cascadas de Anular (cotización, contrato y proyecto).
//  3. Interfaz (app + mod-adicionales conectada al servidor simulado): casilla «Adicional», bloque de cobranza y renglones de
//     contratado / adicionales / total en la vista y en el resumen (y su CSV).
// Uso: node tests/adicionales.test.js .
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || '.';

// ================= 0. Regresión (sin adicionales, todo igual que antes) =================
const esperado = JSON.parse(fs.readFileSync(path.join(__dirname, 'adicionales-regresion.json'), 'utf8'));
// Único cambio a propósito sobre la salida del código de antes (revisión del incremento 7, dinero): "Por cobrar" del resumen suma
// solo saldos positivos; el pago de más de PRY-AAAA-0101 dentro de la tolerancia (saldo −0.50) ya no resta del total
assert.deepStrictEqual([esperado.puras.resumenGeneral.totales[0].porCobrar, esperado.servidor.resumenGeneral.totales[0].porCobrar], [247.5, 5099.5]);
esperado.puras.resumenGeneral.totales[0].porCobrar = 248;
esperado.servidor.resumenGeneral.totales[0].porCobrar = 5100;
const obtenido = require('./adicionales-regresion')(dir);
Object.keys(esperado.puras).forEach(k => assert.deepStrictEqual(obtenido.puras[k], esperado.puras[k], 'regresión (pura): ' + k));
Object.keys(esperado.servidor).forEach(k => assert.deepStrictEqual(obtenido.servidor[k], esperado.servidor[k], 'regresión (servidor): ' + k));
assert.deepStrictEqual(obtenido, esperado, 'regresión completa');

const A = require('./arnes')(dir, { props: {
  ROL_COBRANZA: 'tania@helgen.tech, efrain@helgen.tech', ADMIN_DESBLOQUEO: 'efrain@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech', ROL_OPERACIONES: '' } });
const { P, ok, falla, plain, props, libros, archivos, HOY_ISO, masDias, correr, PDF } = A;
const HOY = '2026-10-29';

// ================= 1. Lógica pura =================
// Tipo de cotización y lo que manda la interfaz
assert.equal(P.tipoCotizacion('Adicional'), 'Adicional');
assert.equal(P.tipoCotizacion(' adicional '), 'Adicional', 'sin mayúsculas ni espacios');
assert.equal(P.tipoCotizacion(''), '');
assert.equal(P.tipoCotizacion('Normal'), '');
assert.equal(P.tipoCotizacion(undefined), '');
assert.equal(P.esPedidoAdicional({ adicional: true }), true);
assert.equal(P.esPedidoAdicional({ adicional: 'true' }), true);
assert.equal(P.esPedidoAdicional({ tipo: 'ADICIONAL' }), true);
assert.equal(P.esPedidoAdicional({ adicional: false }), false);
assert.equal(P.esPedidoAdicional({}), false);
assert.equal(P.esPedidoAdicional(null), false);
// Regla al cotizar en un proyecto: firmado = contrato firmado ({moneda}) o null
P.reglaCotizacionAdicional(null, false, 'MXN', 'PRY-X'); // normal sin contrato firmado: como siempre
assert.throws(() => P.reglaCotizacionAdicional({ moneda: 'MXN' }, false, 'MXN', 'PRY-X'),
  e => /^Proyecto con contrato firmado: no admite cotizaciones nuevas/.test(e.message) && e.codigo === 'PROYECTO' && /«Adicional»/.test(e.message));
P.reglaCotizacionAdicional({ moneda: 'MXN' }, true, 'MXN', 'PRY-X'); // adicional en la moneda del contrato
assert.throws(() => P.reglaCotizacionAdicional({ moneda: 'USD' }, true, 'MXN', 'PRY-X'), e => /debe ser en USD/.test(e.message) && !e.codigo);
assert.throws(() => P.reglaCotizacionAdicional(null, true, 'MXN', 'PRY-X'), /Solo un proyecto con contrato firmado admite cotizaciones adicionales/);
// Aceptar como adicional
assert.deepEqual(plain(P.esquemaAdicionalPorOmision()), [{ etapa: 'Pago único', porcentaje: 100 }]);
const firmadoMxn = { estado: 'Firmado', moneda: 'MXN' };
P.validarAceptarAdicional({ folio: 'HLG-1', tipo: 'Adicional', moneda: 'MXN', total: 10 }, firmadoMxn);
assert.throws(() => P.validarAceptarAdicional({ folio: 'HLG-1', tipo: '', moneda: 'MXN', total: 10 }, firmadoMxn), /no está marcada como adicional/);
assert.throws(() => P.validarAceptarAdicional({ folio: 'HLG-1', tipo: 'Adicional', moneda: 'MXN', total: 10 }, { estado: 'Aceptada', moneda: 'MXN' }), /contrato del proyecto está firmado/);
assert.throws(() => P.validarAceptarAdicional({ folio: 'HLG-1', tipo: 'Adicional', moneda: 'MXN', total: 10 }, null), /contrato del proyecto está firmado/);
assert.throws(() => P.validarAceptarAdicional({ folio: 'HLG-1', tipo: 'Adicional', moneda: 'USD', total: 10 }, firmadoMxn), /nunca se mezclan monedas/);
assert.throws(() => P.validarAceptarAdicional({ folio: 'HLG-1', tipo: 'Adicional', moneda: 'MXN', total: 0 }, firmadoMxn), /no tiene monto/);
// Claves y etiquetas de etapa (para facturas de clientes: etapas del contrato o de una adicional)
assert.equal(P.claveEtapaCobranza('', 2), 'CONTRATO#2');
assert.equal(P.claveEtapaCobranza('hlg-2026-0010', 1), 'HLG-2026-0010#1');
assert.equal(P.etiquetaEtapaCobranza({ etapa: 'Anticipo', adicional: '' }), 'Anticipo');
assert.equal(P.etiquetaEtapaCobranza({ etapa: 'Pago único', adicional: 'HLG-2026-0010' }), 'Pago único (adicional HLG-2026-0010)');
const L3 = [{ adicional: '' }, { adicional: '' }, { adicional: 'HLG-A' }, { adicional: 'HLG-B' }, { adicional: 'HLG-B' }];
assert.deepEqual([P.indiceEtapaCobranza(L3, '', 1), P.indiceEtapaCobranza(L3, '', 9), P.indiceEtapaCobranza(L3, 'hlg-b', 2),
  P.indiceEtapaCobranza(L3, 'HLG-B', 7), P.indiceEtapaCobranza(L3, 'HLG-A', 0), P.indiceEtapaCobranza(L3, 'HLG-X', 1)], [0, 1, 4, 4, 2, 0]);
// Adicionales con sus etapas (para resumenCobranza): solo Aceptadas, de la moneda del contrato, sin repetir; sin filas → por omisión
const filasE = [{ orden: 2, etapa: 'Fin', porcentaje: 40, adicional: 'HLG-B' }, { orden: 1, etapa: 'Inicio', porcentaje: 60, adicional: 'HLG-B', fechaEsperada: '2026-11-01' },
  { orden: 1, etapa: 'Anticipo', porcentaje: 100, adicional: '' }];
const conEt = plain(P.adicionalesConEtapas([{ cotizacion: 'hlg-a', total: 116, subtotal: 100, moneda: 'MXN', estado: 'Aceptada' },
  { cotizacion: 'HLG-B', total: 232, subtotal: 200, moneda: 'MXN', estado: 'Aceptada' }, { cotizacion: 'HLG-B', total: 999, moneda: 'MXN', estado: 'Aceptada' },
  { cotizacion: 'HLG-C', total: 50, moneda: 'MXN', estado: 'Cancelada' }, { cotizacion: 'HLG-D', total: 50, moneda: 'USD', estado: 'Aceptada' }], filasE, 'MXN'));
assert.deepEqual(conEt.map(a => a.cotizacion), ['HLG-A', 'HLG-B'], 'sin canceladas, sin otra moneda, sin repetidas');
assert.deepEqual(conEt[0].etapas, [{ etapa: 'Pago único', porcentaje: 100 }]);
assert.deepEqual(conEt[1].etapas, [{ etapa: 'Inicio', porcentaje: 60, fechaEsperada: '2026-11-01' }, { etapa: 'Fin', porcentaje: 40, fechaEsperada: '' }], 'por orden');

// resumenCobranza con adicionales: contrato 1,160 (50/50), adicional A 116 (una etapa), B 232 (50/50)
const contrato = { proyectoFolio: 'PRY-2026-0101', cotizacion: 'HLG-2026-0201', marca: 'helgen', moneda: 'MXN', subtotal: 1000, total: 1160, estado: 'Firmado' };
const etapasC = [{ etapa: 'Anticipo', porcentaje: 50 }, { etapa: 'Entrega', porcentaje: 50 }];
const adics = [{ cotizacion: 'HLG-2026-0301', subtotal: 100, total: 116, etapas: [{ etapa: 'Pago único', porcentaje: 100 }] },
  { cotizacion: 'HLG-2026-0302', subtotal: 200, total: 232, etapas: [{ etapa: 'Inicio', porcentaje: 50 }, { etapa: 'Fin', porcentaje: 50 }] }];
const pg = (etapaOrden, montoAplicado, etapaAdicional, estado) => ({ estado: estado || 'Vigente', etapaOrden, montoAplicado, etapaAdicional: etapaAdicional || '' });
let r = plain(P.resumenCobranza(contrato, etapasC, [pg(1, 580), pg(2, 600), pg(2, 50, 'HLG-2026-0302'), pg(1, 999, '', 'Cancelado')], adics));
assert.deepEqual(r.etapas.map(e => [e.adicional, e.orden, e.etapa, e.monto, e.pagado, e.saldo]), [
  ['', 1, 'Anticipo', 580, 580, 0], ['', 2, 'Entrega', 580, 580, 0], ['HLG-2026-0301', 1, 'Pago único', 116, 20, 96],
  ['HLG-2026-0302', 1, 'Inicio', 116, 0, 116], ['HLG-2026-0302', 2, 'Fin', 116, 50, 66]], 'el excedente del contrato pasa a la adicional; un pago puede ir a una etapa de adicional');
assert.deepEqual([r.contratado, r.adicionales, r.adicionalesSubtotal, r.nAdicionales, r.total, r.pagado, r.saldo, r.avance, r.subtotal],
  [1160, 348, 300, 2, 1508, 1230, 278, 81.6, 1000], 'saldo = contrato + adicionales − pagado; avance contra el total');
// Un pago a la última etapa con excedente vuelve a las anteriores (contrato incluido)
r = plain(P.resumenCobranza(contrato, etapasC, [pg(2, 1000, 'HLG-2026-0302')], adics));
assert.deepEqual(r.etapas.map(e => e.pagado), [580, 304, 0, 0, 116], 'Fin (116) → al terminar la lista, desde la primera del contrato');
// Tolerancia: lo que no cabe en ninguna etapa se suma a la etapa elegida (puede ser de una adicional)
r = plain(P.resumenCobranza(contrato, etapasC, [pg(1, 1508.5, 'HLG-2026-0301')], adics));
assert.deepEqual([r.saldo, r.etapas[2].pagado, r.etapas[2].saldo], [-0.5, 116.5, -0.5]);
// Un pago dirigido a una adicional que ya no está (anulada) empieza en la primera etapa del contrato
r = plain(P.resumenCobranza(contrato, etapasC, [pg(1, 100, 'HLG-2026-0399')], adics));
assert.deepEqual(r.etapas.map(e => e.pagado), [100, 0, 0, 0, 0]);
// Con [] las cifras son las de siempre (y se agregan los campos nuevos); sin cuarto argumento, el objeto de antes, sin campos nuevos
const base = plain(P.resumenCobranza(contrato, etapasC, [pg(1, 700), pg(2, 10, 'HLG-2026-0301')]));
const conVacio = plain(P.resumenCobranza(contrato, etapasC, [pg(1, 700), pg(2, 10, 'HLG-2026-0301')], []));
assert.deepEqual(Object.keys(base), ['moneda', 'contratado', 'subtotal', 'pagado', 'saldo', 'avance', 'etapas'], 'sin cuarto argumento: mismos campos');
assert.deepEqual(Object.keys(base.etapas[0]), ['etapa', 'porcentaje', 'monto', 'pagado', 'saldo', 'avance']);
['moneda', 'contratado', 'subtotal', 'pagado', 'saldo', 'avance'].forEach(k => assert.deepEqual(conVacio[k], base[k], k));
assert.deepEqual(conVacio.etapas.map(e => [e.monto, e.pagado, e.saldo, e.avance]), base.etapas.map(e => [e.monto, e.pagado, e.saldo, e.avance]));
assert.deepEqual([conVacio.adicionales, conVacio.nAdicionales, conVacio.total], [0, 0, 1160]);
// Una adicional repetida o sin folio no se suma dos veces
assert.equal(P.resumenCobranza(contrato, etapasC, [], [adics[0], adics[0], { cotizacion: '', total: 50 }]).total, 1276);

// etapasPorCobrar / antiguedadCxc / flujo con adicionales (d.adicionales); las filas de Esquemas con adicional no son etapas del contrato
const proyectos = [{ folio: 'PRY-2026-0101', folioVisible: 'PRY-2026-0101-UNO', nombre: 'Uno', cliente: 'Cliente A', clienteId: 'AAA', estado: 'Activo' }];
const esquemas = [
  { proyectoFolio: 'PRY-2026-0101', orden: 1, etapa: 'Anticipo', porcentaje: 50, fechaEsperada: '2026-09-01', adicional: '' },
  { proyectoFolio: 'PRY-2026-0101', orden: 2, etapa: 'Entrega', porcentaje: 50, fechaEsperada: '2026-11-20', adicional: '' },
  { proyectoFolio: 'PRY-2026-0101', orden: 1, etapa: 'Pago único', porcentaje: 100, fechaEsperada: '2026-10-20', adicional: 'HLG-2026-0301' },
  { proyectoFolio: 'PRY-2026-0101', orden: 1, etapa: 'Inicio', porcentaje: 50, fechaEsperada: '', adicional: 'HLG-2026-0302' },
  { proyectoFolio: 'PRY-2026-0101', orden: 2, etapa: 'Fin', porcentaje: 50, fechaEsperada: '2027-06-01', adicional: 'HLG-2026-0302' }];
const filaAdic = (cotizacion, total, subtotal, moneda, estado) => ({ proyectoFolio: 'PRY-2026-0101', cotizacion, total, subtotal, moneda: moneda || 'MXN', estado: estado || 'Aceptada' });
const dR = { hoy: HOY, contratos: [contrato], esquemas, proyectos, pagos: [Object.assign(pg(1, 580), { proyectoFolio: 'PRY-2026-0101' })],
  adicionales: [filaAdic('HLG-2026-0301', 116, 100), filaAdic('HLG-2026-0302', 232, 200), filaAdic('HLG-2026-0303', 500, 400, 'USD'),
    filaAdic('HLG-2026-0005', 50, 40)] }; // HLG-2026-0005 es folio de prueba: fuera de los reportes
let partidas = plain(P.etapasPorCobrar(dR));
assert.deepEqual(partidas.map(x => [x.adicional || '', x.orden, x.etapa, x.monto, x.fecha]), [
  ['', 2, 'Entrega', 580, '2026-11-20'], ['HLG-2026-0301', 1, 'Pago único (adicional HLG-2026-0301)', 116, '2026-10-20'],
  ['HLG-2026-0302', 1, 'Inicio (adicional HLG-2026-0302)', 116, ''], ['HLG-2026-0302', 2, 'Fin (adicional HLG-2026-0302)', 116, '2027-06-01']],
  'las etapas de las adicionales se cobran con su fecha esperada (sin la de otra moneda ni la de prueba)');
assert.equal(partidas[1].etapaNombre, 'Pago único');
assert.equal(Object.prototype.hasOwnProperty.call(partidas[0], 'adicional'), false, 'las partidas del contrato no cambian de forma');
// Sin d.adicionales: solo el contrato (y las filas de adicionales no se confunden con etapas del contrato)
assert.deepEqual(plain(P.etapasPorCobrar(Object.assign({}, dR, { adicionales: undefined }))).map(x => [x.etapa, x.monto]), [['Entrega', 580]]);
const cxc = plain(P.antiguedadCxc(dR));
assert.deepEqual(cxc.totales.map(t => [t.moneda, t.total, t.vencido, t.porVencer, t.d1a30, t.sinFecha]), [['MXN', 928, 116, 696, 116, 116]],
  'la adicional vencida hace 9 días y la sin fecha entran a la antigüedad');
const fl = plain(P.flujoSemanal({ hoy: HOY, semanas: 13, cobros: P.etapasPorCobrar(dR), pagos: [] }));
const flMxn = (fl.monedas || fl).find(m => m.moneda === 'MXN');
assert.equal(flMxn.semanas[0].cobros, 116, 'la etapa vencida de la adicional cae en la semana en curso');
assert.equal(flMxn.semanas[0].cobrosVencidos, 116);
// Resumen general: contratado, adicionales y total aparte; por cobrar con las adicionales; siguiente etapa con su etiqueta
const rgD = { contratos: [contrato], esquemas, proyectos, ordenes: [], pagos: [Object.assign(pg(1, 1160), { proyectoFolio: 'PRY-2026-0101', fecha: '2026-10-01' })],
  adicionales: dR.adicionales.filter(a => a.cotizacion !== 'HLG-2026-0005') }; // el resumen no excluye folios de prueba (como siempre)
const rg = plain(P.resumenGeneralCobranza(rgD));
assert.deepEqual([rg.proyectos[0].contratado, rg.proyectos[0].adicionales, rg.proyectos[0].nAdicionales, rg.proyectos[0].total, rg.proyectos[0].saldo,
  rg.proyectos[0].siguienteEtapa], [1160, 348, 2, 1508, 348, 'Pago único (adicional HLG-2026-0301)']);
assert.deepEqual([rg.totales[0].contratado, rg.totales[0].adicionales, rg.totales[0].total, rg.totales[0].cobrado, rg.totales[0].porCobrar, rg.totales[0].avance],
  [1160, 348, 1508, 1160, 348, 76.9]);
assert.equal(rg.totales[0].contratadoSinIva, 1000, 'el margen lo conecta el integrador: aquí sigue el contratado sin IVA del contrato');
const rgSin = plain(P.resumenGeneralCobranza(Object.assign({}, rgD, { adicionales: undefined })));
assert.equal(rgSin.proyectos[0].adicionales, undefined, 'sin d.adicionales: renglones de antes');
assert.equal(rgSin.proyectos[0].saldo, 0);
// Fechas esperadas: el orden se repite solo dentro del mismo esquema; máximo 10 por esquema
assert.deepEqual(plain(P.normalizarFechasEsperadas([{ orden: 1, etapa: 'Anticipo', fecha: '' }, { orden: 1, etapa: ' Pago  único ', fecha: '2026-11-01', adicional: ' hlg-2026-0301 ' }])),
  [{ orden: 1, etapa: 'Anticipo', fecha: '' }, { orden: 1, etapa: 'Pago único', fecha: '2026-11-01', adicional: 'HLG-2026-0301' }]);
assert.throws(() => P.normalizarFechasEsperadas([{ orden: 1, etapa: 'A', adicional: 'HLG-2026-0301' }, { orden: 1, etapa: 'B', adicional: 'HLG-2026-0301' }]), /repetida/);
assert.throws(() => P.normalizarFechasEsperadas([{ orden: 1, etapa: 'A', adicional: 'no es folio' }]), /Etapa no válida/);
assert.throws(() => P.normalizarFechasEsperadas(Array.from({ length: 11 }, (_, i) => ({ orden: (i % 10) + 1, etapa: 'E', adicional: 'HLG-2026-0301' }))), /máximo 10/);
assert.equal(P.normalizarFechasEsperadas(Array.from({ length: 12 }, (_, i) => ({ orden: (i % 6) + 1, etapa: 'E', adicional: i < 6 ? '' : 'HLG-2026-0301' }))).length, 12,
  'contrato (6) + adicional (6): cada esquema con su máximo');

// adicionalesPorProyecto (contrato §1): solo Aceptadas; subtotal y total por proyecto en su moneda; nunca se mezclan monedas
const app = plain(P.adicionalesPorProyecto([
  { proyectoFolio: 'PRY-2026-0101', cotizacion: 'HLG-1', subtotal: 0.1, total: 0.12, moneda: 'MXN', estado: 'Aceptada' },
  { proyectoFolio: 'pry-2026-0101-uno', cotizacion: 'HLG-2', subtotal: 0.2, total: 0.23, moneda: 'MXN', estado: 'Aceptada' },
  { proyectoFolio: 'PRY-2026-0101', cotizacion: 'HLG-3', subtotal: 50, total: 58, moneda: 'MXN', estado: 'Cancelada' },
  { proyectoFolio: 'PRY-2026-0101', cotizacion: 'HLG-4', subtotal: 50, total: 58, moneda: 'MXN', estado: 'Anulada' },
  { proyectoFolio: 'PRY-2026-0101', cotizacion: 'HLG-5', subtotal: 9, total: 9, moneda: 'USD', estado: 'Aceptada' },
  { proyectoFolio: 'PRY-2026-0102', cotizacion: 'HLG-6', subtotal: 1000, total: 1160, moneda: 'USD', estado: 'Aceptada' },
  null, { proyectoFolio: '', cotizacion: 'HLG-7', subtotal: 1, total: 1, estado: 'Aceptada' }]));
assert.deepEqual(app, { 'PRY-2026-0101': { subtotal: 0.3, total: 0.35, moneda: 'MXN', n: 2, revisar: 1 },
  'PRY-2026-0102': { subtotal: 1000, total: 1160, moneda: 'USD', n: 1 } });
assert.deepEqual(plain(P.adicionalesPorProyecto([])), {});
assert.deepEqual(plain(P.adicionalesPorProyecto(undefined)), {});


// ================= 2. Servidor (doPost) =================
props.SUPER_ADMIN = 'leo@helgen.tech';
P.prepararCapri(); // Anular (super admin) necesita el libro de Administración; los roles pasan a Permisos
const LC = () => libros[props.COBRANZA_DB_ID];
const H = n => LC().pest[n].m;
const COT = () => libros.DB.pest.Cotizaciones.m;
let nId = 0;
const id = p => (p || 'x') + (++nId);
const pry = (nombre, cliente) => ok('ana', 'crearProyecto', { nombre, ubicacion: 'Qro', cliente: { nombre: cliente, empresa: cliente + ' SA' }, idSolicitud: id('p') });
const cotizar = (pf, precio, extra) => ok('ana', 'guardarCotizacion', Object.assign({ cliente: { nombre: 'Cliente', empresa: 'Cliente SA' },
  items: [{ descripcion: 'Servicio', cantidad: 1, precio }], proyectoFolio: pf, moneda: 'MXN', idSolicitud: id('c') }, extra || {}));
const cotFalla = (pf, precio, extra, re, codigo) => falla('ana', 'guardarCotizacion', [Object.assign({ cliente: { nombre: 'Cliente' },
  items: [{ descripcion: 'Servicio', cantidad: 1, precio }], proyectoFolio: pf, moneda: 'MXN', idSolicitud: id('c') }, extra || {})], re, codigo);
const pagar = (pf, monto, etapaOrden, etapaAdicional) => ok('tania', 'registrarPago', { proyectoFolio: pf, fecha: HOY_ISO, monto, metodo: 'Transferencia',
  referencia: 'SPEI ' + id('r'), etapaOrden, etapaAdicional: etapaAdicional || '', comprobante: { datos: PDF }, idSolicitud: id('g') });
const pagoFalla = (pf, monto, etapaOrden, etapaAdicional, re) => falla('tania', 'registrarPago', [{ proyectoFolio: pf, fecha: HOY_ISO, monto,
  metodo: 'Transferencia', referencia: 'SPEI', etapaOrden, etapaAdicional: etapaAdicional || '', comprobante: { datos: PDF }, idSolicitud: id('g') }], re);
const vista = pf => ok('tania', 'getCobranzaProyecto', pf);
const iTipo = 22; // columna W de Cotizaciones

// Proyectos: A (MXN, firmado), B (USD, Helgen Energy, firmado), C (aceptada sin firmar), D (sin contrato)
const pA = pry('Planta Norte', 'Cliente A').folio, pB = pry('Terminal Sur', 'Cliente B').folio, pC = pry('Bodega', 'Cliente C').folio,
  pD = pry('Patio', 'Cliente D').folio;
const cA = cotizar(pA, 10000).folio, cA2 = cotizar(pA, 300).folio, cB = cotizar(pB, 2000, { moneda: 'USD', marca: 'energy' }).folio,
  cC = cotizar(pC, 500).folio;
ok('tania', 'marcarAceptada', pA, cA, true); ok('tania', 'firmarContrato', pA, HOY_ISO);
ok('tania', 'marcarAceptada', pB, cB, true); ok('tania', 'firmarContrato', pB, HOY_ISO);
ok('tania', 'marcarAceptada', pC, cC, true);
const esquemaContratoA = () => H('Esquemas').slice(1).filter(x => x[0] === pA && !x[6]).map(x => x.slice(0, 6).map(String));
const contratoAntes = esquemaContratoA();
assert.equal(contratoAntes.length, 3, 'el esquema del contrato (60/30/10)');
assert.deepEqual(H('Esquemas')[0].slice(-1), ['adicional'], 'columna adicional (se crea sola, por nombre)');

// ---- Cotizar: la regla del contrato firmado en los dos sentidos ----
cotFalla(pA, 100, {}, /^Proyecto con contrato firmado: no admite cotizaciones nuevas/, 'PROYECTO');
const folioAntes = COT().length;
cotFalla(pA, 100, { adicional: true, moneda: 'USD' }, /debe ser en MXN, la moneda del contrato/);
cotFalla(pC, 100, { adicional: true }, /Solo un proyecto con contrato firmado admite cotizaciones adicionales/);
cotFalla(pD, 100, { adicional: true }, /Solo un proyecto con contrato firmado admite cotizaciones adicionales/);
cotFalla('', 100, { adicional: true }, /elige el proyecto/);
assert.equal(COT().length, folioAntes, 'ningún rechazo gasta folio ni escribe');
const ad1 = cotizar(pA, 1000, { adicional: true });
assert.equal(ad1.tipo, 'Adicional');
const fila1 = COT().find(x => x[0] === ad1.folio);
assert.equal(fila1[iTipo], 'Adicional', 'columna tipo');
assert.equal(fila1[19], pA);
assert.equal(COT()[0][iTipo], 'tipo', 'encabezado tipo (se crea solo)');
const pdfAd1 = archivos[ad1.url.match(/\/d\/([^/]+)/)[1]];
assert(/Cotización adicional al proyecto/.test(pdfAd1.blob.html) && /PRY-\d{4}-\d{4}-[A-Z]{3} · Planta Norte/.test(pdfAd1.blob.html), 'el PDF lo dice');
assert(/Cotizaciones/.test(pdfAd1.padre.nombre), 'PDF en la carpeta del proyecto');
const ad2 = cotizar(pA, 500, { tipo: 'adicional' }); // también con tipo
const ad3 = cotizar(pA, 250, { adicional: true });
const adB = cotizar(pB, 100, { adicional: true, moneda: 'USD' });
assert.equal(COT().find(x => x[0] === cC)[iTipo], '', 'las normales quedan vacías');
const sinProy = cotizar('', 10);
assert.equal(COT().find(x => x[0] === sinProy.folio)[iTipo], '');

// ---- Ventas: proyectos con contrato firmado solo para adicionales ----
const bAna = ok('ana', 'bootstrap');
assert.deepEqual(bAna.proyectosFirmados.map(p => [p.folio, p.contratoFirmado, p.moneda]).sort(), [[pA, true, 'MXN'], [pB, true, 'USD']]);
assert(!bAna.proyectos.some(p => p.folio === pA), 'el buscador de siempre sigue sin los firmados');
assert(bAna.proyectosFirmados.every(p => p.carpetaId === undefined && p.total === undefined), 'sin ids de Drive ni montos');
assert.equal(ok('rosa', 'bootstrap').proyectosFirmados, undefined, 'solo requisiciones: nada');

// ---- Cobranza: vista antes de aceptar ----
let v = vista(pA);
assert.deepEqual(v.cotizaciones.filter(q => q.tipo === 'Adicional').map(q => q.folio).sort(), [ad1.folio, ad2.folio, ad3.folio].sort());
assert.deepEqual(v.adicionalesPorAceptar.map(q => q.folio).sort(), [ad1.folio, ad2.folio, ad3.folio].sort());
assert.deepEqual([v.adicionales.length, v.puedeAceptarAdicional, v.resumen.nAdicionales, v.resumen.total], [0, true, 0, 11600]);
falla('tania', 'marcarAceptada', [pA, ad1.folio, true], /es adicional/);
// Permisos: solo cobranza
falla('ana', 'aceptarAdicional', [pA, ad1.folio], /permiso de cobranza/, 'PERMISO');
falla('pedro', 'guardarEsquemaAdicional', [pA, ad1.folio, [{ etapa: 'X', porcentaje: 100 }]], /permiso de cobranza/, 'PERMISO');
falla('obrero', 'cancelarAdicional', [pA, ad1.folio, 'motivo largo'], /permiso de cobranza/, 'PERMISO');
falla('tania', 'aceptarAdicional', [pA, cA2], /no está marcada como adicional/);
falla('tania', 'aceptarAdicional', [pA, adB.folio], /no pertenece al proyecto/);
falla('tania', 'aceptarAdicional', [pC, cC], /no está marcada como adicional/);
// Una cotización marcada a mano como adicional en un proyecto sin firmar no se acepta
COT().find(x => x[0] === cC)[iTipo] = 'Adicional';
falla('tania', 'aceptarAdicional', [pC, cC], /contrato del proyecto está firmado/);
COT().find(x => x[0] === cC)[iTipo] = '';

// ---- Aceptar ----
const verAntes = Object.assign({}, ok('tania', 'sincronizar', {}, {}).versiones);
v = ok('tania', 'aceptarAdicional', pA, ad1.folio);
const verDespues = ok('tania', 'sincronizar', {}, {}).versiones;
assert(verAntes.adicionales !== verDespues.adicionales && verAntes.contratos !== verDespues.contratos, 'sube adicionales y contratos');
assert.deepEqual(v.adicionales.map(a => [a.cotizacion, a.total, a.estado, a.etapas.length, a.etapas[0].etapa, a.etapas[0].porcentaje, a.etapas[0].monto, a.esquemaEditable, a.puedeCancelar]),
  [[ad1.folio, 1160, 'Aceptada', 1, 'Pago único', 100, 1160, true, true]]);
assert.deepEqual([v.resumen.contratado, v.resumen.adicionales, v.resumen.nAdicionales, v.resumen.total, v.resumen.saldo], [11600, 1160, 1, 12760, 12760]);
assert.deepEqual(v.esquema.map(e => e.etapa), ['Anticipo', 'Instalación', 'Encendido del sistema'], 'el esquema del contrato no cambia');
assert.deepEqual(esquemaContratoA(), contratoAntes, 'sus filas tampoco');
const filaAd = H('Adicionales').find(x => x[1] === ad1.folio);
assert.deepEqual([filaAd[0], filaAd[2], filaAd[3], filaAd[4], filaAd[5], filaAd[6], filaAd[7], filaAd[8]], [pA, 'Helgen', 'MXN', 1000, 160, 1160, 'Aceptada', 'tania@helgen.tech']);
assert.deepEqual(H('Esquemas').slice(1).filter(x => x[6] === ad1.folio).map(x => [x[0], x[1], x[2], x[3], x[4]]), [[pA, 1, 'Pago único', 100, 1160]]);
assert(H('Bitacora').some(x => x[2] === 'Aceptar adicional' && String(x[4]).includes(ad1.folio)));
const nFilas = H('Adicionales').length;
ok('tania', 'aceptarAdicional', pA, ad1.folio);
assert.equal(H('Adicionales').length, nFilas, 'aceptar dos veces no duplica');
v = ok('tania', 'aceptarAdicional', pA, ad2.folio);
assert.deepEqual(v.adicionales.map(a => a.cotizacion), [ad1.folio, ad2.folio], 'en el orden en que se aceptaron');
assert.deepEqual(v.adicionalesPorAceptar.map(q => q.folio), [ad3.folio]);
// Helgen Energy: el esquema de una adicional lo edita cobranza (las reglas 60/30/10 son del contrato)
ok('tania', 'aceptarAdicional', pB, adB.folio);
v = ok('tania', 'guardarEsquemaAdicional', pB, adB.folio, [{ etapa: 'Inicio', porcentaje: 30 }, { etapa: 'Fin', porcentaje: 70 }]);
assert.deepEqual(v.adicionales[0].etapas.map(e => [e.etapa, e.monto]), [['Inicio', 34.8], ['Fin', 81.2]]);
assert.deepEqual(v.esquema.map(e => e.porcentaje), [60, 30, 10], 'el 60/30/10 del contrato Energy sigue igual');

// ---- Esquema de la adicional ----
falla('tania', 'guardarEsquemaAdicional', [pA, ad1.folio, [{ etapa: 'A', porcentaje: 90 }]], /suman 90%/);
falla('tania', 'guardarEsquemaAdicional', [pA, ad3.folio, [{ etapa: 'A', porcentaje: 100 }]], /no está aceptada/);
v = ok('tania', 'guardarEsquemaAdicional', pA, ad1.folio, [{ etapa: 'Anticipo', porcentaje: 50 }, { etapa: 'Entrega', porcentaje: 50 }]);
assert.deepEqual(v.adicionales[0].etapas.map(e => [e.orden, e.clave, e.etapa, e.monto]), [[1, ad1.folio + '#1', 'Anticipo', 580], [2, ad1.folio + '#2', 'Entrega', 580]]);
assert.deepEqual(esquemaContratoA(), contratoAntes, 'editar la adicional no toca el contrato');
assert.deepEqual(H('Esquemas').slice(1).filter(x => x[6] === ad2.folio).length, 1, 'ni las otras adicionales');
assert(H('Bitacora').some(x => x[2] === 'Editar esquema de adicional' && /antes Pago único 100%/.test(x[4])));

// ---- Fechas esperadas (incremento 6) de las etapas de una adicional ----
v = ok('tania', 'guardarFechasEsperadas', pA, [{ orden: 1, etapa: 'Anticipo', fecha: masDias(-10), adicional: ad1.folio },
  { orden: 2, etapa: 'Instalación', fecha: masDias(30) }]);
assert.equal(v.adicionales[0].etapas[0].fechaEsperada, masDias(-10));
assert.deepEqual(v.esquema.map(e => e.fechaEsperada), ['', masDias(30), ''], 'la del contrato con el mismo orden no se confunde');
falla('tania', 'guardarFechasEsperadas', [pA, [{ orden: 1, etapa: 'Pago único', fecha: HOY_ISO, adicional: ad1.folio }]], /cambió mientras capturabas/);
falla('tania', 'guardarFechasEsperadas', [pA, [{ orden: 3, etapa: 'X', fecha: HOY_ISO, adicional: ad1.folio }]], /cambió mientras capturabas/);
assert(H('Bitacora').some(x => x[2] === 'Fechas esperadas de cobro' && String(x[4]).includes('Anticipo (adicional ' + ad1.folio + ')')));
// La fecha se conserva al reescribir su esquema (por nombre de etapa)
ok('tania', 'guardarEsquemaAdicional', pA, ad1.folio, [{ etapa: 'Anticipo', porcentaje: 40 }, { etapa: 'Entrega', porcentaje: 60 }]);
v = vista(pA);
assert.deepEqual(v.adicionales[0].etapas.map(e => [e.etapa, e.monto, e.fechaEsperada]), [['Anticipo', 464, masDias(-10)], ['Entrega', 696, '']]);

// ---- Cobro: contrato 11,600 + ad1 1,160 (40/60) + ad2 580 = 13,340 ----
assert.deepEqual([v.resumen.total, v.resumen.saldo], [13340, 13340]);
pagoFalla(pA, 10, 1, 'HLG-2099-0001', /no está aceptada/);
pagoFalla(pA, 10, 3, ad1.folio, /Elige la etapa del pago/);
let rp = pagar(pA, 100, 2, ad1.folio); // a la etapa 2 de la adicional
let filaPago = H('Pagos').find(x => x[0] === rp.folio);
assert.deepEqual([filaPago[11], filaPago[12], filaPago[22]], [2, 'Entrega (adicional ' + ad1.folio + ')', ad1.folio], 'etapa_orden, etapa y etapa_adicional');
assert.deepEqual(JSON.parse(filaPago[13]), [{ etapa: 'Entrega', orden: 2, adicional: ad1.folio, monto: 100 }]);
v = rp.vista;
assert.deepEqual(v.adicionales[0].etapas.map(e => e.pagado), [0, 100]);
assert.deepEqual([v.adicionales[0].pagado, v.adicionales[0].saldo, v.adicionales[0].esquemaEditable, v.adicionales[0].puedeCancelar], [100, 1060, false, false]);
assert.deepEqual([v.resumen.pagado, v.resumen.saldo], [100, 13240]);
assert.equal(v.pagos[0].etapaAdicional, ad1.folio);
// Un pago al contrato que lo liquida y sobra: el excedente pasa a las etapas de las adicionales
rp = pagar(pA, 11600 + 500, 1);
filaPago = H('Pagos').find(x => x[0] === rp.folio);
assert.deepEqual(JSON.parse(filaPago[13]), [{ etapa: 'Anticipo', orden: 1, monto: 6960 }, { etapa: 'Instalación', orden: 2, monto: 3480 },
  { etapa: 'Encendido del sistema', orden: 3, monto: 1160 }, { etapa: 'Anticipo', orden: 1, adicional: ad1.folio, monto: 464 },
  { etapa: 'Entrega', orden: 2, adicional: ad1.folio, monto: 36 }], 'contrato y luego la adicional (sin etapa_adicional: era al contrato)');
assert.equal(filaPago[22], '');
v = rp.vista;
assert.deepEqual([v.resumen.pagado, v.resumen.saldo], [12200, 1140]);
assert.deepEqual(v.adicionales.map(a => [a.pagado, a.saldo]), [[600, 560], [0, 580]]);
// Tolerancia de 1.00 contra el nuevo total
pagoFalla(pA, 1141.01, 1, ad2.folio, /excede el saldo del proyecto \(\$1,140\.00 MXN\)/);
// Con pagos aplicados: su esquema ya no cambia ni se cancela
falla('tania', 'guardarEsquemaAdicional', [pA, ad1.folio, [{ etapa: 'A', porcentaje: 100 }]], /ya tiene pagos aplicados/);
falla('tania', 'cancelarAdicional', [pA, ad1.folio, 'ya no la quiere'], /tiene pagos aplicados/);

// ---- Cancelar (sin pagos) ----
falla('tania', 'cancelarAdicional', [pA, ad2.folio, 'no'], /motivo/);
ok('tania', 'aceptarAdicional', pA, ad3.folio);
v = ok('tania', 'cancelarAdicional', pA, ad3.folio, 'El cliente ya no la quiere');
assert.deepEqual(v.adicionales.map(a => a.cotizacion), [ad1.folio, ad2.folio]);
assert(v.adicionalesPorAceptar.some(q => q.folio === ad3.folio), 'la cotización sigue en el proyecto (se puede volver a aceptar)');
const fila3 = H('Adicionales').find(x => x[1] === ad3.folio);
assert.deepEqual([fila3[7], fila3[11], fila3[13]], ['Cancelada', 'tania@helgen.tech', 'El cliente ya no la quiere']);
assert.equal(H('Esquemas').slice(1).filter(x => x[6] === ad3.folio).length, 0, 'su esquema sale de Esquemas');
assert(H('Bitacora').some(x => x[2] === 'Cancelar adicional' && x[5] === 'El cliente ya no la quiere' && /esquema Pago único 100%/.test(x[4])));
falla('tania', 'cancelarAdicional', [pA, ad3.folio, 'otra vez'], /no está aceptada/);
// El último pago, dentro de la tolerancia (0.50 de más), liquida contrato y adicionales
rp = pagar(pA, 1140.5, 1, ad2.folio);
assert.deepEqual([rp.vista.resumen.pagado, rp.vista.resumen.saldo, rp.vista.adicionales[1].etapas[0].pagado], [13340.5, -0.5, 580.5]);
falla('tania', 'cancelarAdicional', [pA, ad2.folio, 'motivo valido'], /tiene pagos aplicados/);

// ---- Desbloquear el contrato no toca las adicionales ----
const adicAntes = JSON.stringify(H('Adicionales')), esqAdicAntes = JSON.stringify(H('Esquemas').filter(x => x[6]));
v = ok('efrain', 'desbloquearContrato', pA, 'Se firmó con un error en el anticipo');
assert.deepEqual([v.contrato.estado, v.adicionales.length, v.resumen.total], ['Aceptada', 2, 13340]);
assert.equal(JSON.stringify(H('Adicionales')), adicAntes); assert.equal(JSON.stringify(H('Esquemas').filter(x => x[6])), esqAdicAntes);
falla('tania', 'aceptarAdicional', [pA, ad3.folio], /contrato del proyecto está firmado/);
cotFalla(pA, 10, { adicional: true }, /Solo un proyecto con contrato firmado/);
const cUsd = cotizar(pA, 10, { moneda: 'USD' }).folio; // desbloqueado: vuelve a admitir cotizaciones normales (como antes)
falla('tania', 'marcarAceptada', [pA, cUsd, true], /tiene adicionales en MXN/);
ok('tania', 'guardarEsquema', pA, [{ etapa: 'Anticipo', porcentaje: 50 }, { etapa: 'Fin', porcentaje: 50 }], '');
assert.equal(JSON.stringify(H('Esquemas').filter(x => x[6])), esqAdicAntes, 'reescribir el esquema del contrato no toca las adicionales');
v = ok('tania', 'firmarContrato', pA, HOY_ISO);
assert.deepEqual([v.contrato.estado, v.resumen.total, v.resumen.saldo, v.adicionales.length], ['Firmado', 13340, -0.5, 2]);
assert.equal(JSON.stringify(H('Adicionales')), adicAntes);

// ---- Resumen de cobranza, CxC y flujo ----
let rs = ok('tania', 'resumenCobranzaGeneral');
let renA = rs.proyectos.find(x => x.folio === pA);
assert.deepEqual([renA.contratado, renA.adicionales, renA.nAdicionales, renA.total, renA.pagado, renA.saldo], [11600, 1740, 2, 13340, 13340.5, -0.5]);
const totMxn = rs.totales.find(t => t.moneda === 'MXN');
assert.deepEqual([totMxn.contratado, totMxn.adicionales, totMxn.total], [11600, 1740, 13340]);
const renB = rs.proyectos.find(x => x.folio === pB);
assert.deepEqual([renB.moneda, renB.contratado, renB.adicionales, renB.total, renB.saldo], ['USD', 2320, 116, 2436, 2436]);
// CxC: la etapa de la adicional de B (USD) con su fecha
ok('tania', 'guardarFechasEsperadas', pB, [{ orden: 1, etapa: 'Inicio', fecha: masDias(-40), adicional: adB.folio }]);
const rc = ok('tania', 'reporteCxc');
const partB = rc.grupos.find(g => g.moneda === 'USD').detalle[0].partidas;
assert(partB.some(x => x.adicional === adB.folio && x.etapa === 'Inicio (adicional ' + adB.folio + ')' && x.monto === 34.8 && x.rango === 'd31a60'), 'CxC con la etapa de la adicional');
assert.equal(rc.totales.find(t => t.moneda === 'USD').total, 2436);
const rfl = ok('leo', 'reporteFlujo');
const usd = (rfl.monedas || []).find(m => m.moneda === 'USD');
assert(usd && usd.semanas[0].cobrosVencidos >= 34.8, 'flujo: la etapa vencida de la adicional en la semana en curso');

// ---- Anular (super admin): la adicional es su cotización HLG ----
const prev = ok('leo', 'previsualizarAnulacion', adB.folio);
assert.deepEqual(prev.registros.map(x => [x.tipo, x.folio, x.estado]), [['Cotización', adB.folio, 'Adicional aceptada'], ['Adicional', 'ADICIONAL ' + adB.folio, 'Aceptada']]);
assert(prev.efectos.some(t => /queda sin la adicional/.test(t) && /se vuelven a repartir/.test(t)));
ok('leo', 'anular', adB.folio, 'Se capturó en el proyecto equivocado', id('a'));
assert.equal(H('Adicionales').find(x => x[1] === adB.folio)[7], 'Anulada');
assert.equal(H('Esquemas').slice(1).filter(x => x[6] === adB.folio).length, 0, 'su esquema se borra');
assert.equal(H('Esquemas').slice(1).filter(x => x[0] === pB && !x[6]).length, 3, 'el del contrato se queda');
const anulB = libros[props.ADMIN_DB_ID].pest.Anulaciones.m.find(x => x[3] === 'ADICIONAL ' + adB.folio);
assert(anulB && JSON.parse(anulB[6]).hoja === 'Adicionales' && JSON.parse(anulB[6]).esquema.length === 2, 'copia en Anulaciones con su esquema');
v = vista(pB);
assert.deepEqual([v.adicionales.length, v.resumen.total, v.cotizaciones.some(q => q.folio === adB.folio)], [0, 2320, false]);
assert(!ok('tania', 'resumenCobranzaGeneral').proyectos.find(x => x.folio === pB).adicionales, 'el resumen ya no la suma');
// Anular el contrato arrastra sus adicionales (y sus pagos); el proyecto queda sin aceptada
const prevC = ok('leo', 'previsualizarAnulacion', 'CONTRATO ' + pA);
assert.deepEqual(prevC.registros.filter(x => x.tipo === 'Adicional').map(x => x.folio).sort(), ['ADICIONAL ' + ad1.folio, 'ADICIONAL ' + ad2.folio].sort());
ok('leo', 'anular', 'CONTRATO ' + pA, 'El contrato se registró con otro cliente', id('a'));
assert.deepEqual(H('Adicionales').filter(x => x[0] === pA).map(x => x[7]).sort(), ['Anulada', 'Anulada', 'Cancelada']);
assert.equal(H('Esquemas').slice(1).filter(x => x[0] === pA).length, 0, 'ni contrato ni adicionales');
v = vista(pA);
assert.deepEqual([v.contrato, v.adicionales.length, v.pagos.length, v.puedeAceptarAdicional], [null, 0, 0, false]);
// Anular el proyecto completo arrastra la adicional
const pE = pry('Muelle', 'Cliente E').folio, cE = cotizar(pE, 100).folio;
ok('tania', 'marcarAceptada', pE, cE, true); ok('tania', 'firmarContrato', pE, HOY_ISO);
const adE = cotizar(pE, 50, { adicional: true }).folio;
ok('tania', 'aceptarAdicional', pE, adE);
const prevE = ok('leo', 'previsualizarAnulacion', pE);
assert(prevE.registros.some(x => x.folio === 'ADICIONAL ' + adE), 'proyecto → contrato → adicional');
ok('leo', 'anular', pE, 'Proyecto duplicado por error', id('a'));
assert.equal(H('Adicionales').find(x => x[1] === adE)[7], 'Anulada');
assert(!ok('ana', 'bootstrap').proyectosFirmados.some(p => p.folio === pE), 'ya no sale para cotizar');

// Proyecto Cerrado: ya no se cotiza, pero una adicional ya cotizada sí se acepta; Cancelado: nada
const pKo = pry('Kiosco', 'Cliente K'), pK = pKo.folio, cK = cotizar(pK, 100).folio;
ok('tania', 'marcarAceptada', pK, cK, true); ok('tania', 'firmarContrato', pK, HOY_ISO);
const adK = cotizar(pK, 40, { adicional: true }).folio, adK2 = cotizar(pK, 30, { adicional: true }).folio;
const filaK = libros.DB.pest.Proyectos.m.find(x => x[0] === pK);
filaK[6] = 'Cerrado';
cotFalla(pK, 10, { adicional: true }, /está cerrado/, 'PROYECTO');
assert.equal(ok('tania', 'aceptarAdicional', pK, adK).adicionales.length, 1, 'Cerrado: se acepta');
filaK[6] = 'Cancelado';
falla('tania', 'aceptarAdicional', [pK, adK2], /está cancelado/);
falla('tania', 'guardarEsquemaAdicional', [pK, adK, [{ etapa: 'A', porcentaje: 100 }]], /está cancelado/);
falla('tania', 'cancelarAdicional', [pK, adK, 'motivo suficiente'], /está cancelado/);
v = vista(pK);
assert.deepEqual([v.puedeAceptarAdicional, v.adicionales[0].esquemaEditable, v.adicionales[0].puedeCancelar, v.adicionales[0].fechasEditables], [false, false, false, false]);
filaK[6] = 'Activo';

// ================= 3. Interfaz (app + mod-adicionales, conectada al servidor simulado) =================
const html = fs.readFileSync(path.join(dir, 'web/home/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)].map(m => ({ id: m[1], src: m[2] }));
assert(scripts.some(s => s.id === 'mod-adicionales'), 'existe <script id="mod-adicionales">');
assert(/<label id="cotAdicionalCaja" class="oculto"/.test(html) && /<input type="checkbox" id="cotAdicional"/.test(html), 'casilla «Adicional», oculta de inicio');
assert(/<div id="cobAdicionales" class="oculto"><\/div>/.test(html), 'bloque de adicionales en cobranza');
function montar(quien) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = 'h.' + b64({ email: quien + '@helgen.tech', given_name: quien, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.f';
  function elemento(tag) {
    const e = { tag, value: '', textContent: '', className: '', title: '', src: '', placeholder: '', disabled: false, hijos: [], oyentes: {}, _clases: new Set(), porClase: {},
      classList: { add: c => e._clases.add(c), remove: c => e._clases.delete(c), contains: c => e._clases.has(c), toggle: (c, f) => f ? e._clases.add(c) : e._clases.delete(c) },
      addEventListener: (t, f) => (e.oyentes[t] = e.oyentes[t] || []).push(f), disparar: t => (e.oyentes[t] || []).forEach(f => f({ target: e })),
      focus() {}, remove() {}, click() {}, appendChild: h => e.hijos.push(h), prepend: h => e.hijos.unshift(h), contains: () => false,
      querySelector: sel => e.porClase[sel] || (e.porClase[sel] = elemento('input')), querySelectorAll: sel => sel === 'tr' ? e.hijos : [] };
    let h = ''; Object.defineProperty(e, 'innerHTML', { get: () => h, set: v => { h = v; if (v === '') e.hijos.length = 0; } });
    return e;
  }
  const porId = {}, oyentesDoc = {};
  const document = { getElementById: id => porId[id] || (porId[id] = elemento('div')), querySelector: () => ({ src: 'data:logo' }), createElement: t => elemento(t),
    visibilityState: 'visible', activeElement: null, body: elemento('body'),
    addEventListener: (t, f) => (oyentesDoc[t] = oyentesDoc[t] || []).push(f), dispatchEvent: ev => (oyentesDoc[ev.type] || []).forEach(f => f(ev)) };
  document.getElementById('login').classList.add('oculto');
  ['cotAdicionalCaja', 'cobAdicionales'].forEach(i => document.getElementById(i).classList.add('oculto')); // como en el HTML
  const almacen = { cotizadorHelgenSesion: token }, llamadas = [], dialogos = { prompt: null, mensajes: [] };
  async function fetch(url, o) {
    const c = JSON.parse(o.body); llamadas.push(c);
    const datos = A.post(quien, c.funcion, ...c.args);
    return { ok: true, json: async () => datos };
  }
  class FileReader { readAsDataURL(f) { this.result = 'data:' + f.type + ';base64,' + f.b64; setImmediate(() => this.onload()); } }
  const ctx = { document, fetch, console, JSON, Date, Math, Number, String, Array, Object, Promise, Proxy, Error, Uint8Array, TextDecoder, FileReader,
    atob: s => Buffer.from(s, 'base64').toString('binary'), crypto: { randomUUID: () => 'id-' + Math.random() },
    sessionStorage: { getItem: k => almacen[k] ?? null, setItem: (k, v) => almacen[k] = v, removeItem: k => delete almacen[k] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, confirm: () => true,
    prompt: m => { dialogos.mensajes.push(String(m)); return dialogos.prompt; },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    setTimeout, clearTimeout, setInterval: () => 0, scrollTo() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['api-web', undefined, 'mod-adicionales'].forEach(n => vm.runInContext(scripts.find(x => x.id === n).src, ctx));
  return { ctx, $: id => document.getElementById(id), llamadas, dialogos, run: c => vm.runInContext(c, ctx) };
}
const esperar = async (k = 30) => { for (let i = 0; i < k; i++) await new Promise(r => setImmediate(r)); };
// Datos: F (MXN, firmado) con una adicional por aceptar y otra aceptada sin pagos; G (USD, firmado); H (activo, sin contrato)
const pFo = pry('Planta Fresa', 'Cliente F'), pGo = pry('Grúas', 'Cliente G'), pHo = pry('Hangar', 'Cliente H');
const pF = pFo.folio, pG = pGo.folio, cF = cotizar(pF, 1000).folio, cG = cotizar(pG, 100, { moneda: 'USD' }).folio;
ok('tania', 'marcarAceptada', pF, cF, true); ok('tania', 'firmarContrato', pF, HOY_ISO);
ok('tania', 'marcarAceptada', pG, cG, true); ok('tania', 'firmarContrato', pG, HOY_ISO);
const adF = cotizar(pF, 200, { adicional: true }).folio, adF2 = cotizar(pF, 300, { adicional: true }).folio;
ok('tania', 'aceptarAdicional', pF, adF2);
(async () => {
  // ---- Ventas: la casilla «Adicional» solo con un proyecto de contrato firmado ----
  const V = montar('ana');
  await esperar();
  assert(V.run('PROYECTOS_FIRMADOS').some(p => p.folio === pF && p.contratoFirmado && p.moneda === 'MXN'), 'recibe los de contrato firmado');
  assert(!V.run('PROYECTOS').some(p => p.folio === pF), 'la lista de siempre no cambia');
  assert(/Contrato firmado · solo cotización adicional/.test(V.$('proyectosList').innerHTML) && V.$('proyectosList').innerHTML.includes(pFo.folioVisible), 'en el buscador, marcados');
  assert(V.$('cotAdicionalCaja').classList.contains('oculto'));
  V.$('proyecto').value = pHo.folioVisible; V.$('proyecto').disparar('change');
  assert(V.$('cotAdicionalCaja').classList.contains('oculto'), 'proyecto sin contrato firmado: sin casilla');
  V.$('proyecto').value = pFo.folioVisible; V.$('proyecto').disparar('change');
  assert(!V.$('cotAdicionalCaja').classList.contains('oculto'), 'contrato firmado: aparece la casilla');
  assert(/solo admite cotizaciones adicionales/.test(V.$('proyInfo').textContent), V.$('proyInfo').textContent);
  const tr = V.$('filas').hijos[0];
  tr.querySelector('.desc').value = 'Trabajo extra'; tr.querySelector('.cant').value = '1'; tr.querySelector('.pu').value = '800'; tr.querySelector('.uni').value = 'SER';
  V.$('cNombre').value = 'Cliente F';
  V.run('guardar()'); await esperar();
  assert(/solo admite cotizaciones adicionales\. Marca «Adicional»/.test(V.$('aviso').innerHTML), 'sin la casilla no se guarda: ' + V.$('aviso').innerHTML);
  assert(!V.llamadas.some(c => c.funcion === 'guardarCotizacion'));
  V.$('cotAdicional').checked = true; V.run('alMarcarAdicional()');
  V.run('guardar()'); await esperar();
  const g = V.llamadas.find(c => c.funcion === 'guardarCotizacion');
  assert.deepEqual([g.args[0].proyectoFolio, g.args[0].adicional, g.args[0].moneda], [pF, true, 'MXN']);
  assert(/\(adicional\) guardada/.test(V.$('aviso').innerHTML), V.$('aviso').innerHTML);
  assert.equal(V.$('cotAdicional').checked, false, 'al limpiar se quita la marca');
  const nueva = COT()[COT().length - 1];
  assert.deepEqual([nueva[19], nueva[iTipo], nueva[9]], [pF, 'Adicional', 928]);
  // USD: al marcar la casilla la cotización pasa a la moneda del contrato
  V.$('proyecto').value = pGo.folioVisible; V.$('proyecto').disparar('change');
  V.$('cotAdicional').checked = true; V.run('alMarcarAdicional()');
  assert.equal(V.$('moneda').value, 'USD', 'la moneda del contrato');
  // Con otra moneda la interfaz avisa antes de llamar al servidor
  V.$('moneda').value = 'MXN';
  const n0 = V.llamadas.filter(c => c.funcion === 'guardarCotizacion').length;
  const tr2 = V.$('filas').hijos[0]; tr2.querySelector('.desc').value = 'Extra'; tr2.querySelector('.cant').value = '1'; tr2.querySelector('.pu').value = '5';
  V.$('cNombre').value = 'Cliente G';
  V.run('guardar()'); await esperar();
  assert(/debe ser en USD/.test(V.$('aviso').innerHTML) && V.llamadas.filter(c => c.funcion === 'guardarCotizacion').length === n0);
  // Un proyecto normal deja la casilla oculta y sin marca
  V.$('proyecto').value = pHo.folioVisible; V.$('proyecto').disparar('change');
  assert(V.$('cotAdicionalCaja').classList.contains('oculto') && V.$('cotAdicional').checked === false);

  // ---- Cobranza: bloque de adicionales y renglones de contratado / adicionales / total ----
  const T = montar('tania');
  await esperar();
  T.run('abrirProyectoCob(' + JSON.stringify(pF) + ')'); await esperar();
  let caja = T.$('cobAdicionales');
  assert(!caja.classList.contains('oculto') && /Por aceptar/.test(caja.innerHTML) && caja.innerHTML.includes(adF) && /Aceptar adicional/.test(caja.innerHTML), 'por aceptar');
  assert(caja.innerHTML.includes(adF2) && /Cancelar adicional/.test(caja.innerHTML) && /Guardar esquema/.test(caja.innerHTML), 'aceptada sin pagos: editable y cancelable');
  assert(/>Adicional</.test(T.$('cobCots').innerHTML) && /Adicional aceptada/.test(T.$('cobCots').innerHTML), 'chips en las cotizaciones');
  T.run('ADICIONALES.aceptar(' + JSON.stringify(adF) + ')'); await esperar();
  assert.deepEqual(T.llamadas.find(c => c.funcion === 'aceptarAdicional').args, [pF, adF]);
  assert(/Adicional <b>/.test(T.$('aviso').innerHTML) && /aceptada/.test(T.$('aviso').innerHTML));
  const tiles = T.$('cobResumen').innerHTML;
  assert(/Contratado \(con IVA\)<\/span><b>\$1,160\.00 MXN/.test(tiles) && /Adicionales \(con IVA\)<\/span><b>\$580\.00 MXN/.test(tiles) &&
    /Total contratado<\/span><b>\$1,740\.00 MXN/.test(tiles), 'renglones aparte: ' + tiles);
  assert(/Adicionales \(2\)/.test(T.$('cobContrato').innerHTML) && /Total contratado: <b>\$1,740\.00 MXN/.test(T.$('cobContrato').innerHTML));
  assert(T.$('pgEtapa').innerHTML.includes('value="' + adF2 + '#1"') && T.$('pgEtapa').innerHTML.includes('Adicional ' + adF2 + ' · 1'), 'etapas de adicionales para pagar');
  // Esquema de la segunda adicional (índice 1: en el orden en que se aceptaron, adF2 es la 0)
  const iF = 1;
  T.run('ADICIONALES.editarEtapa(' + iF + ', 0, "porcentaje", 60)');
  T.run('ADICIONALES.agregarEtapa(' + iF + ')');
  T.run('ADICIONALES.editarEtapa(' + iF + ', 1, "etapa", "Fin"); ADICIONALES.editarEtapa(' + iF + ', 1, "porcentaje", 40)');
  T.run('ADICIONALES.guardarEsquema(' + iF + ')'); await esperar();
  assert.deepEqual(T.llamadas.find(c => c.funcion === 'guardarEsquemaAdicional').args, [pF, adF, [{ etapa: 'Pago único', porcentaje: 60 }, { etapa: 'Fin', porcentaje: 40 }]]);
  assert(T.$('cobAdicionales').innerHTML.includes('Fin'), 'pintado con lo guardado');
  // Pago a la etapa 2 de esa adicional desde el formulario
  ['pgMonto', 'pgRef'].forEach((k, i) => { T.$(k).value = ['50', 'SPEI 77'][i]; });
  T.$('pgFecha').value = HOY_ISO; T.$('pgMoneda').value = 'MXN'; T.$('pgMetodo').value = 'Transferencia'; T.$('pgEtapa').value = adF + '#2';
  T.$('pgArchivo').files = [{ name: 'spei.pdf', type: 'application/pdf', size: 2048, b64: PDF }];
  T.run('registrarPago()'); await esperar();
  const rpU = T.llamadas.find(c => c.funcion === 'registrarPago');
  assert.deepEqual([rpU.args[0].etapaAdicional, rpU.args[0].etapaOrden], [adF, 2]);
  assert(/Pago <b>PAG-/.test(T.$('aviso').innerHTML), T.$('aviso').innerHTML);
  v = vista(pF);
  assert.deepEqual(v.adicionales[1].etapas.map(e => e.pagado), [0, 50]);
  caja = T.$('cobAdicionales');
  assert(/con pagos: su esquema ya no cambia/.test(caja.innerHTML), 'con pagos ya no se edita');
  // Fechas esperadas de la adicional: solo las que cambiaron, con su adicional
  T.$('adicFecha_0_1').value = masDias(7);
  T.run('ADICIONALES.guardarFechas(0)'); await esperar();
  assert.deepEqual(T.llamadas.find(c => c.funcion === 'guardarFechasEsperadas').args, [pF, [{ orden: 1, etapa: 'Pago único', fecha: masDias(7), adicional: adF2 }]]);
  assert.equal(vista(pF).adicionales[0].etapas[0].fechaEsperada, masDias(7));
  // Cancelar la que no tiene pagos (motivo con prompt)
  T.dialogos.prompt = 'El cliente la canceló';
  T.run('ADICIONALES.cancelar(0)'); await esperar();
  assert.deepEqual(T.llamadas.find(c => c.funcion === 'cancelarAdicional').args, [pF, adF2, 'El cliente la canceló']);
  assert.deepEqual(vista(pF).adicionales.map(a => a.cotizacion), [adF]);
  // Resumen: contratado, adicionales y total aparte; CSV con las columnas nuevas al final
  T.run('verResumenCob()'); await esperar();
  assert(/Adicionales \(con IVA\)/.test(T.$('resTotales').innerHTML) && /Total contratado/.test(T.$('resTotales').innerHTML), T.$('resTotales').innerHTML);
  assert(/\+ adicionales \$232\.00 MXN/.test(T.$('resLista').innerHTML) && /= total \$1,392\.00 MXN/.test(T.$('resLista').innerHTML), 'renglón del proyecto');
  const csv = T.run('csvResumenCob(RESUMEN.proyectos)').split('\r\n');
  assert(csv[0].endsWith('"Margen %","Adicionales con IVA","Total contratado con IVA"'), csv[0]);
  const filaF = csv.find(l => l.includes(pFo.folioVisible));
  assert(/,232\.00,1392\.00$/.test(filaF), filaF);
  // Un proyecto sin adicionales no muestra el bloque ni los renglones nuevos
  T.run('abrirProyectoCob(' + JSON.stringify(pG) + ')'); await esperar();
  assert(T.$('cobAdicionales').classList.contains('oculto') && !/Adicionales \(con IVA\)/.test(T.$('cobResumen').innerHTML));
  console.log('OK adicionales (regresión, lógica pura, servidor, interfaz)');
})().catch(e => { console.error(e); process.exit(1); });
