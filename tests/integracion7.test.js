// Incremento 7 · integración (§6.I): margen = contrato + adicionales − órdenes − gastos − nómina, en la tarjeta de cobranza, el
// resumen de cobranza y Reportes → margen (las tres cifras iguales); gastos o nómina en otra moneda no se suman («Revisar»);
// NOMINA_EN_MARGEN = superadmin; cachés y sincronización con las colecciones del incremento 7; y las facturas de clientes con las
// etapas de las adicionales (cobranzaParaFacturas: antes las leía como etapas del contrato).
// Los lectores de gastos y de nómina se sustituyen aquí (sus reglas las prueban gastos.test.js y nomina.test.js): lo que se prueba
// es cómo se juntan. Uso: node tests/integracion7.test.js .
'use strict';
const assert = require('assert');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {
  ROL_COBRANZA: 'tania@helgen.tech, leo@helgen.tech', ADMIN_DESBLOQUEO: 'leo@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech', ROL_OPERACIONES: '', SUPER_ADMIN: 'leo@helgen.tech' } });
const { P, ok, falla, plain, props, HOY_ISO, PDF } = A;

// ================= 1. Lógica pura =================
const OC = (m, mon) => ({ concepto: 'Órdenes de compra', moneda: mon || 'MXN', monto: m, cantidad: 1 });
const GA = (m, mon) => ({ concepto: 'Gastos', moneda: mon || 'MXN', monto: m, cantidad: 2 });
const NO = (m, h, s) => ({ concepto: 'Nómina', moneda: 'MXN', monto: m, horas: h, sinCostear: s || 0 });
let m = plain(P.margenCompleto(10000, 'MXN', [OC(3000), GA(500), NO(1500, 40, 4)], { subtotal: 1000, moneda: 'MXN' }));
assert.deepEqual([m.contrato, m.adicionales, m.contratado, m.totalCostos, m.margen, m.porcentaje], [10000, 1000, 11000, 5000, 6000, 54.5]);
assert.deepEqual(m.costos.find(c => c.concepto === 'Nómina'), { concepto: 'Nómina', moneda: 'MXN', monto: 1500, cantidad: 0, horas: 40, sinCostear: 4 },
  'la nómina lleva sus horas (nunca personas)');
assert.equal(m.sinSumar, undefined);
// Gastos o nómina en otra moneda: aparte, sin sumar (el margen se calcula con lo demás)
m = plain(P.margenCompleto(1000, 'USD', [OC(100, 'USD'), GA(50, 'USD'), GA(800, 'MXN'), NO(2000, 10)], null));
assert.deepEqual([m.contratado, m.totalCostos, m.margen, m.adicionales], [1000, 150, 850, 0]);
assert.deepEqual(m.sinSumar, [{ concepto: 'Gastos', moneda: 'MXN', monto: 800, cantidad: 2 }, { concepto: 'Nómina', moneda: 'MXN', monto: 2000, cantidad: 0 }]);
// Una orden o una adicional en otra moneda siguen siendo error (no deberían existir)
assert.throws(() => P.margenCompleto(1000, 'USD', [OC(100, 'MXN')], null), /no se suman monedas distintas/);
assert.throws(() => P.margenCompleto(1000, 'USD', [], { subtotal: 10, moneda: 'MXN' }), /adicional en otra moneda/);
assert.throws(() => P.margenCompleto(1000, 'MXN', [], { subtotal: 10, moneda: 'MXN', revisar: 1 }), /adicional en otra moneda/);
// Centavos exactos
m = plain(P.margenCompleto(0.1, 'MXN', [GA(0.2)], { subtotal: 0.2, moneda: 'MXN' }));
assert.deepEqual([m.contratado, m.margen], [0.3, 0.1]);
// Unir gastos y nómina por proyecto (folios en mayúsculas)
assert.deepEqual(plain(P.costosExtraPorProyecto({ 'pry-2026-0001': [GA(1)] }, { 'PRY-2026-0001': [NO(2, 1)], 'PRY-2026-0002': [NO(3, 1)] })),
  { 'PRY-2026-0001': [GA(1), NO(2, 1)], 'PRY-2026-0002': [NO(3, 1)] });
assert.deepEqual(plain(P.costosExtraPorProyecto(null, undefined)), {});

// El resumen y el margen por proyecto con adicionales y costos extra
const contrato = { proyectoFolio: 'PRY-2026-0101', cotizacion: 'HLG-1', marca: 'helgen', moneda: 'MXN', subtotal: 10000, iva: 1600, total: 11600, estado: 'Firmado' };
const proy = [{ folio: 'PRY-2026-0101', estado: 'Activo', nombre: 'Planta', cliente: 'Cliente' }];
const adic = [{ proyectoFolio: 'PRY-2026-0101', cotizacion: 'HLG-2', subtotal: 1000, iva: 160, total: 1160, moneda: 'MXN', estado: 'Aceptada' }];
const extra = { 'PRY-2026-0101': [GA(500), NO(1500, 40), GA(30, 'USD')] };
const res = plain(P.resumenGeneralCobranza({ contratos: [contrato], esquemas: [], pagos: [], proyectos: proy, ordenes: [], adicionales: adic, costosExtra: extra }));
const rp = res.proyectos[0];
assert.deepEqual([rp.margenContratado, rp.costoOc, rp.margen, rp.margenPorcentaje], [11000, 2000, 9000, 81.8]);
assert.deepEqual(rp.sinSumar, [{ concepto: 'Gastos', moneda: 'USD', monto: 30, cantidad: 2 }]);
assert.deepEqual([res.totales[0].contratadoSinIva, res.totales[0].costoOc, res.totales[0].margen], [11000, 2000, 9000], 'totales con adicionales');
const mp = plain(P.margenPorProyecto({ contratos: [contrato], proyectos: proy, ordenes: [], prueba: [], adicionales: adic, costosExtra: extra }));
assert.deepEqual([mp.proyectos[0].contratado, mp.proyectos[0].contrato, mp.proyectos[0].adicionales, mp.proyectos[0].margen],
  [11000, 10000, 1000, 9000], 'Reportes → margen: la misma cifra');
assert.deepEqual(mp.conceptos, ['Órdenes de compra', 'Gastos', 'Nómina']);
assert.deepEqual(mp.totales[0].costos, [{ concepto: 'Órdenes de compra', monto: 0 }, { concepto: 'Gastos', monto: 500 }, { concepto: 'Nómina', monto: 1500 }],
  'el total por concepto no suma lo de otra moneda');
// Sin los campos nuevos: igual que antes (sin margenContratado, costos ni sinSumar en el renglón)
const antes = plain(P.resumenGeneralCobranza({ contratos: [contrato], esquemas: [], pagos: [], proyectos: proy, ordenes: [] })).proyectos[0];
assert.deepEqual([antes.margen, antes.margenContratado, antes.costos, antes.sinSumar], [10000, undefined, undefined, undefined]);

// Facturas de clientes con adicionales: las etapas de la adicional no se leen como del contrato y llevan su clave '<HLG>/<orden>'
const esq = [{ proyectoFolio: 'PRY-2026-0101', orden: 1, etapa: 'Anticipo', porcentaje: 60, adicional: '' },
  { proyectoFolio: 'PRY-2026-0101', orden: 2, etapa: 'Final', porcentaje: 40, adicional: '' },
  { proyectoFolio: 'PRY-2026-0101', orden: 1, etapa: 'Pago único', porcentaje: 100, adicional: 'HLG-2' }];
const cobProy = { 'PRY-2026-0101': proy[0] };
const conA = plain(P.cobranzaParaFacturas({ contratos: [contrato], esquemas: esq, pagos: [], proyectos: cobProy, adicionales: adic }))['PRY-2026-0101'];
assert.deepEqual(conA.etapas.map(e => [e.clave, e.etapa, e.monto]), [['1', 'Anticipo', 6960], ['2', 'Final', 4640], ['HLG-2/1', 'Pago único', 1160]]);
const sinA = plain(P.cobranzaParaFacturas({ contratos: [contrato], esquemas: esq, pagos: [], proyectos: cobProy }))['PRY-2026-0101'];
assert.deepEqual(sinA.etapas.map(e => [e.clave, e.monto]), [['1', 6960], ['2', 4640]], 'sin adicionales: solo las del contrato (antes salían 3)');

// ================= 2. Servidor: tarjeta, resumen y reporte con la misma cifra =================
P.prepararCapri();
let nId = 0;
const id = p => (p || 'x') + (++nId);
const pry = nombre => ok('ana', 'crearProyecto', { nombre, ubicacion: 'Qro', cliente: { nombre: 'Cliente ' + nombre, empresa: 'SA' }, idSolicitud: id('p') });
const cotizar = (pf, precio, extraC) => ok('ana', 'guardarCotizacion', Object.assign({ cliente: { nombre: 'Cliente', empresa: 'SA' },
  items: [{ descripcion: 'Servicio', cantidad: 1, precio }], proyectoFolio: pf, moneda: 'MXN', idSolicitud: id('c') }, extraC || {}));
pry('Relleno 1'); pry('Relleno 2'); // PRY-AAAA-0001 es de prueba en los reportes (FOLIOS_PRUEBA_REPORTES)
const pA = pry('Planta Norte').folio, pB = pry('Patio Sur').folio;
const cA = cotizar(pA, 10000).folio;
ok('tania', 'marcarAceptada', pA, cA, true);
ok('tania', 'firmarContrato', pA, HOY_ISO);
const ad = cotizar(pA, 1000, { adicional: true }).folio;
ok('tania', 'aceptarAdicional', pA, ad);

// Lectores sustituidos (lo de cada módulo lo prueban sus archivos): un gasto aprobado de 500 MXN, uno de 30 USD sin tipo de cambio y
// la nómina repartida (1,500 MXN, 40 h, 4 sin costear) en A; 200 de gasto y 300 de nómina en B (sin contrato)
let lecturasNomina = 0;
P.gastosDelLibro_ = () => [
  { proyectoFolio: pA, estado: 'Aprobado', moneda: 'MXN', subtotal: 500, total: 580 },
  { proyectoFolio: pA, estado: 'Reembolsado', moneda: 'USD', subtotal: 30, total: 30, tipoCambio: '' },
  { proyectoFolio: pA, estado: 'Enviado', moneda: 'MXN', subtotal: 9999, total: 9999 },
  { proyectoFolio: pB, estado: 'Aprobado', moneda: 'MXN', subtotal: 200, total: 232 }];
P.costoNominaDeProyectos_ = () => { lecturasNomina++; const r = {}; r[pA] = [NO(1500, 40, 4)]; r[pB] = [NO(300, 8)]; return r; };
// costosExtraDeProyectos_ solo lee la pestaña si existe
const LCo = () => A.libros[props.COMPRAS_DB_ID];
if (!LCo() || !LCo().pest.Gastos) P.hojaCompras_(P.libroCompras_(), 'Gastos');

const tarjeta = ok('tania', 'getCobranzaProyecto', pA).margen;
assert.deepEqual([tarjeta.contrato, tarjeta.adicionales, tarjeta.contratado, tarjeta.totalCostos, tarjeta.margen],
  [10000, 1000, 11000, 2000, 9000], 'tarjeta de cobranza: contrato + adicional − gastos − nómina');
assert.deepEqual(tarjeta.costos.map(c => [c.concepto, c.monto]), [['Órdenes de compra', 0], ['Gastos', 500], ['Nómina', 1500]]);
assert.deepEqual(tarjeta.sinSumar, [{ concepto: 'Gastos', moneda: 'USD', monto: 30, cantidad: 1 }], 'el gasto en USD no se suma');
assert(!/obrero|@helgen/.test(JSON.stringify(tarjeta)), 'la tarjeta no trae personas');
const sinContrato = ok('tania', 'getCobranzaProyecto', pB).margen;
assert.deepEqual([sinContrato.sinContrato, sinContrato.costos.map(c => [c.concepto, c.moneda, c.monto])],
  [true, [['Gastos', 'MXN', 200], ['Nómina', 'MXN', 300]]], 'sin contrato: costos del proyecto aunque no haya órdenes');
const resumen = ok('tania', 'resumenCobranzaGeneral');
const renglon = resumen.proyectos.find(p => p.folio === pA);
assert.deepEqual([renglon.margenContratado, renglon.costoOc, renglon.margen], [11000, 2000, 9000], 'resumen: la misma cifra');
const reporte = ok('tania', 'reporteMargen');
const fila = reporte.proyectos.find(p => p.folio === pA);
assert.deepEqual([fila.contratado, fila.totalCostos, fila.margen, fila.sinSumar.length], [11000, 2000, 9000, 1], 'Reportes → margen: la misma cifra');

// ================= 3. NOMINA_EN_MARGEN = superadmin =================
props.NOMINA_EN_MARGEN = 'superadmin';
const tTania = ok('tania', 'getCobranzaProyecto', pA).margen, tLeo = ok('leo', 'getCobranzaProyecto', pA).margen;
assert.deepEqual([tTania.margen, tTania.costos.some(c => c.concepto === 'Nómina')], [10500, false], 'cobranza: sin nómina');
assert.deepEqual([tLeo.margen, tLeo.costos.some(c => c.concepto === 'Nómina')], [9000, true], 'super admin: con nómina');
// Cada quien su caché (nunca la versión con nómina para quien no la ve, ni al revés)
assert.equal(ok('tania', 'resumenCobranzaGeneral').proyectos.find(p => p.folio === pA).margen, 10500);
assert.equal(ok('leo', 'resumenCobranzaGeneral').proyectos.find(p => p.folio === pA).margen, 9000);
assert.equal(ok('tania', 'resumenCobranzaGeneral').proyectos.find(p => p.folio === pA).margen, 10500, 'otra vez (del caché)');
assert.equal(ok('tania', 'reporteMargen').proyectos.find(p => p.folio === pA).margen, 10500);
assert.equal(ok('leo', 'reporteMargen').proyectos.find(p => p.folio === pA).margen, 9000);
delete props.NOMINA_EN_MARGEN;
assert.equal(ok('tania', 'getCobranzaProyecto', pA).margen.margen, 9000, 'sin la propiedad: cobranza la ve (el spec)');

// ================= 4. Cachés y sincronización con las colecciones del incremento 7 =================
const r0 = ok('tania', 'resumenCobranzaGeneral').proyectos.find(p => p.folio === pA).margen;
const gastosAntes = P.gastosDelLibro_;
P.gastosDelLibro_ = () => gastosAntes().concat([{ proyectoFolio: pA, estado: 'Aprobado', moneda: 'MXN', subtotal: 1000, total: 1160 }]);
assert.equal(ok('tania', 'resumenCobranzaGeneral').proyectos.find(p => p.folio === pA).margen, r0, 'sin subir la versión: del caché');
const vc = ok('tania', 'sincronizar', {}, {}).versiones;
P.subirVersiones_(['gastos']);
const s = ok('tania', 'sincronizar', vc, { cobProyecto: pA, cobResumen: true });
assert.equal(s.cobranzaProyecto.margen.margen, 8000, 'la vista abierta se vuelve a mandar al cambiar un gasto');
assert.equal(s.resumen.proyectos.find(p => p.folio === pA).margen, 8000, 'y el resumen');
assert.equal(ok('tania', 'reporteMargen').proyectos.find(p => p.folio === pA).margen, 8000, 'el reporte toma la versión de gastos');
['horas', 'costosPersonal', 'adicionales'].forEach(col => {
  const v = ok('tania', 'sincronizar', {}, {}).versiones;
  P.subirVersiones_([col]);
  assert(ok('tania', 'sincronizar', v, { cobProyecto: pA }).cobranzaProyecto, col + ': la vista abierta se vuelve a mandar');
});
const v2 = ok('tania', 'sincronizar', {}, {}).versiones;
P.subirVersiones_(['facturasClientes']);
assert(ok('tania', 'sincronizar', v2, { cobProyecto: pA }).cobranzaProyecto, 'facturasClientes: la vista (con sus facturas) se vuelve a mandar');
// Compras nunca recibe margen
falla('pedro', 'getCobranzaProyecto', [pA], /cobranza/i, 'PERMISO');
falla('pedro', 'reporteMargen', [], /permiso/i, 'PERMISO');
assert(lecturasNomina > 0);

console.log('OK integracion7');
