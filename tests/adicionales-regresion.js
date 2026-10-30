// Incremento 7 · módulo A (Adicionales): REGRESIÓN de cobranza para proyectos SIN adicionales. No es una prueba: la usa
// tests/adicionales.test.js. Corre un mismo escenario (funciones puras con datos fijos + un flujo de cobranza por doPost) y
// devuelve solo las cifras que ya existían antes del módulo A (los campos nuevos no se comparan). La salida del código de antes
// (rama incremento-7-base, commit e6d8b2b) quedó guardada en tests/adicionales-regresion.json; la prueba exige que el código de
// ahora dé exactamente lo mismo.
// Para volver a generar el JSON (solo si cambia el escenario, nunca para "arreglar" una diferencia):
//   node tests/adicionales-regresion.js <carpeta con el Code.js de antes> > tests/adicionales-regresion.json
'use strict';

function escenario(dir) {
  const A = require('./arnes')(dir, { props: {
    ROL_COBRANZA: 'tania@helgen.tech, efrain@helgen.tech', ADMIN_DESBLOQUEO: 'efrain@helgen.tech', ROL_COMPRAS: 'pedro@helgen.tech',
    ROL_REQUISICION: 'obrero@helgen.tech', ROL_OPERACIONES: '' } });
  const { P, ok, plain, libros, props, HOY_ISO, masDias, PDF } = A;
  // Folios con el año en curso → AAAA (la salida no depende del año en que se corre)
  const sinAnio = x => JSON.parse(JSON.stringify(x).replace(/\b(HLG|PRY|PAG)-\d{4}-/g, '$1-AAAA-'));
  const solo = (o, campos) => { const r = {}; campos.forEach(k => { r[k] = o[k]; }); return r; };
  const ETAPA = ['etapa', 'porcentaje', 'monto', 'pagado', 'saldo', 'avance'];
  const RESUMEN = ['moneda', 'contratado', 'subtotal', 'pagado', 'saldo', 'avance'];
  const res = r => Object.assign(solo(r, RESUMEN), { etapas: r.etapas.map(e => solo(e, ETAPA)) });
  const salida = { puras: {}, servidor: {} };

  // ================= 1. Funciones puras con datos fijos =================
  const HOY = '2026-10-29';
  const proyectos = [
    { folio: 'PRY-2026-0101', folioVisible: 'PRY-2026-0101-UNO', nombre: 'Uno', cliente: 'Cliente A', clienteId: 'AAA010101AAA', estado: 'Activo' },
    { folio: 'PRY-2026-0102', folioVisible: 'PRY-2026-0102-DOS', nombre: 'Dos', cliente: 'Cliente B', clienteId: 'BBB010101BBB', estado: 'Activo' },
    { folio: 'PRY-2026-0103', folioVisible: 'PRY-2026-0103-TRE', nombre: 'Tres', cliente: 'Cliente A', clienteId: 'AAA010101AAA', estado: 'Cerrado' },
    { folio: 'PRY-2026-0104', folioVisible: 'PRY-2026-0104-CUA', nombre: 'Cuatro', cliente: 'Cliente C', clienteId: 'SIN-RFC:c', estado: 'Cancelado' },
    { folio: 'PRY-2026-0105', folioVisible: 'PRY-2026-0105-CIN', nombre: 'Cinco', cliente: 'Cliente D', clienteId: 'DDD010101DDD', estado: 'Activo' },
    { folio: 'PRY-2026-0106', folioVisible: 'PRY-2026-0106-SEI', nombre: 'Seis', cliente: 'Cliente E', clienteId: 'EEE010101EEE', estado: 'Activo' },
  ];
  const contratos = [
    { proyectoFolio: 'PRY-2026-0101', cotizacion: 'HLG-2026-0201', marca: 'helgen', moneda: 'MXN', subtotal: 10000, iva: 1600, total: 11600, estado: 'Firmado', fechaFirma: '2026-09-01' },
    { proyectoFolio: 'PRY-2026-0102', cotizacion: 'HLG-2026-0202', marca: 'energy', moneda: 'USD', subtotal: 1000.01, iva: 160, total: 1160.01, estado: 'Firmado', fechaFirma: '2026-09-02' },
    { proyectoFolio: 'PRY-2026-0103', cotizacion: 'HLG-2026-0203', marca: 'helgen', moneda: 'MXN', subtotal: 500, iva: 80, total: 580, estado: 'Aceptada', fechaFirma: '' },
    { proyectoFolio: 'PRY-2026-0104', cotizacion: 'HLG-2026-0204', marca: 'helgen', moneda: 'MXN', subtotal: 900, iva: 144, total: 1044, estado: 'Firmado', fechaFirma: '2026-09-03' },
    { proyectoFolio: 'PRY-2026-0105', cotizacion: 'HLG-2026-0205', marca: 'helgen', moneda: 'MXN', subtotal: 2000, iva: 320, total: 2320, estado: 'Aceptada', fechaFirma: '' },
    { proyectoFolio: 'PRY-2026-0106', cotizacion: 'HLG-2026-0206', marca: 'helgen', moneda: 'MXN', subtotal: 300, iva: 48, total: 348, estado: 'Firmado', fechaFirma: '2026-09-04' },
  ];
  const esq = (pf, lista) => lista.map((x, i) => ({ proyectoFolio: pf, orden: i + 1, etapa: x[0], porcentaje: x[1], fechaEsperada: x[2] || '' }));
  const esquemas = [].concat(
    esq('PRY-2026-0101', [['Anticipo', 60, '2026-08-01'], ['Instalación', 30, '2026-10-29'], ['Encendido del sistema', 10]]),
    esq('PRY-2026-0102', [['Anticipo', 33.33, '2026-06-15'], ['Instalación', 33.33, '2026-11-20'], ['Cierre', 33.34, '2026-02-30']]),
    esq('PRY-2026-0103', [['Total', 100]]),
    esq('PRY-2026-0104', [['Total', 100, '2026-09-01']]),
    esq('PRY-2026-0105', [['Anticipo', 50, '2026-09-15'], ['Final', 50, '2027-03-01']]));
  // PRY-2026-0106 sin esquema guardado (una etapa "Total")
  const pg = (pf, etapaOrden, montoAplicado, estado, fecha) => ({ folio: 'PAG-X', proyectoFolio: pf, etapaOrden, montoAplicado, estado: estado || 'Vigente', fecha: fecha || '2026-09-10' });
  const pagos = [
    pg('PRY-2026-0101', 1, 5000), pg('PRY-2026-0101', 2, 3000, 'Cancelado'), pg('PRY-2026-0101', 3, 2000, 'Vigente', '2026-10-01'),
    pg('PRY-2026-0101', 2, 4600.5, 'Vigente', '2026-10-20'),
    pg('PRY-2026-0102', 9, 400), pg('PRY-2026-0102', 0, 0.01),
    pg('PRY-2026-0104', 1, 100),
    pg('PRY-2026-0105', 2, 300, 'Vigente', '2026-09-20'), // aceptada con pago Vigente = desbloqueada
    pg('PRY-2026-0106', 1, 100),
  ];
  const ordenes = [
    { folio: 'OC-1', proyectoFolio: 'PRY-2026-0101', estado: 'Emitida', moneda: 'MXN', monedaProyecto: 'MXN', subtotalProyecto: 4000, total: 4640 },
    { folio: 'OC-2', proyectoFolio: 'PRY-2026-0102', estado: 'Recibida', moneda: 'USD', monedaProyecto: 'USD', subtotalProyecto: 200, total: 232 },
    { folio: 'OC-3', proyectoFolio: 'PRY-2026-0101', estado: 'Cancelada', moneda: 'MXN', monedaProyecto: 'MXN', subtotalProyecto: 999, total: 999 },
  ];
  const contrato = pf => contratos.find(c => c.proyectoFolio === pf);
  const etapasDe = pf => esquemas.filter(e => e.proyectoFolio === pf).map(e => ({ etapa: e.etapa, porcentaje: e.porcentaje }));
  const pagosDe = pf => pagos.filter(p => p.proyectoFolio === pf);
  ['PRY-2026-0101', 'PRY-2026-0102', 'PRY-2026-0103', 'PRY-2026-0105'].forEach(pf => {
    salida.puras['resumen ' + pf] = res(plain(P.resumenCobranza(contrato(pf), etapasDe(pf), pagosDe(pf))));
  });
  salida.puras['resumen 6106 total'] = res(plain(P.resumenCobranza(contrato('PRY-2026-0106'), [{ etapa: 'Total', porcentaje: 100 }], pagosDe('PRY-2026-0106'))));
  salida.puras.reparto = plain(P.repartirPago([{ monto: 600, pagado: 600 }, { monto: 300, pagado: 100 }, { monto: 100, pagado: 0 }], 1, 450));

  const rg = plain(P.resumenGeneralCobranza({ contratos, esquemas, pagos, proyectos, ordenes }));
  const RG_FILA = ['folio', 'marca', 'moneda', 'estadoContrato', 'contratado', 'subtotal', 'pagado', 'saldo', 'avance', 'siguienteEtapa',
    'siguienteSaldo', 'ultimoPago', 'ordenes', 'costoOc', 'margen', 'margenPorcentaje', 'margenError'];
  const RG_TOT = ['moneda', 'proyectos', 'conSaldo', 'contratado', 'cobrado', 'porCobrar', 'avance', 'contratadoSinIva', 'costoOc', 'margen',
    'margenPorcentaje', 'porFirmar', 'montoPorFirmar'];
  salida.puras.resumenGeneral = { totales: rg.totales.map(t => solo(t, RG_TOT)), proyectos: rg.proyectos.map(p => solo(p, RG_FILA)) };

  const d = { hoy: HOY, contratos, esquemas, pagos, proyectos, ordenes };
  const PARTIDA = ['proyectoFolio', 'marca', 'moneda', 'desbloqueado', 'orden', 'etapa', 'montoEtapa', 'pagadoEtapa', 'monto', 'fecha'];
  salida.puras.etapasPorCobrar = plain(P.etapasPorCobrar(d)).map(x => solo(x, PARTIDA));
  const cxc = plain(P.antiguedadCxc(d));
  salida.puras.cxc = { totales: cxc.totales, grupos: cxc.grupos.map(g => Object.assign(solo(g, ['nombreGrupo', 'moneda', 'vencido', 'total', 'porVencer', 'd1a30', 'd31a60', 'd61a90', 'd90mas', 'sinFecha']),
    { detalle: g.detalle.map(x => Object.assign(solo(x, ['folio', 'vencido', 'total']), { partidas: x.partidas.map(p => solo(p, PARTIDA.concat(['dias', 'rango']))) })) })) };
  const fl = plain(P.flujoSemanal({ hoy: HOY, semanas: 13, cobros: P.etapasPorCobrar(d), pagos: [] }));
  salida.puras.flujo = fl.monedas ? fl.monedas : fl;

  // ================= 2. Servidor (doPost): flujo de cobranza sin adicionales =================
  let n = 0;
  const id = p => p + (++n);
  const pry = (nombre, cliente) => ok('ana', 'crearProyecto', { nombre, ubicacion: 'Qro', cliente: { nombre: cliente, empresa: cliente + ' SA' }, idSolicitud: id('p') }).folio;
  const cot = (pf, cliente, precio, moneda, marca) => ok('ana', 'guardarCotizacion', { cliente: { nombre: cliente }, marca: marca || 'helgen',
    items: [{ descripcion: 'Servicio', cantidad: 1, precio }], proyectoFolio: pf, moneda: moneda || 'MXN', idSolicitud: id('c') }).folio;
  const pagar = (pf, monto, etapaOrden, monedaPago, tipoCambio) => ok('tania', 'registrarPago', { proyectoFolio: pf, fecha: HOY_ISO, monto,
    monedaPago: monedaPago || '', tipoCambio: tipoCambio || '', metodo: 'Transferencia', referencia: 'SPEI ' + n, etapaOrden,
    comprobante: { datos: PDF }, idSolicitud: id('g') });
  // PRY-…-0001 y HLG-…-0005/0006 son folios de prueba (los reportes los dejan fuera): se gastan primero
  pry('Prueba', 'Prueba');
  for (let i = 0; i < 6; i++) cot('', 'Prueba', 1);
  const p1 = pry('Planta Uno', 'Cliente Uno'), p2 = pry('Terminal Dos', 'Cliente Dos'), p3 = pry('Bodega Tres', 'Cliente Tres'),
    p4 = pry('Patio Cuatro', 'Cliente Cuatro');
  const c1 = cot(p1, 'Cliente Uno', 10000), c2 = cot(p2, 'Cliente Dos', 2500.55, 'USD', 'energy'), c3 = cot(p3, 'Cliente Tres', 800),
    c4 = cot(p4, 'Cliente Cuatro', 3000), c4b = cot(p4, 'Cliente Cuatro', 3500);
  ok('tania', 'marcarAceptada', p1, c1, true);
  ok('tania', 'guardarEsquema', p1, [{ etapa: 'Anticipo', porcentaje: 40 }, { etapa: 'Avance', porcentaje: 35 }, { etapa: 'Entrega', porcentaje: 25 }], '');
  ok('tania', 'firmarContrato', p1, HOY_ISO);
  ok('tania', 'marcarAceptada', p2, c2, true); ok('tania', 'firmarContrato', p2, HOY_ISO);
  ok('tania', 'marcarAceptada', p3, c3, true); // por firmar
  ok('tania', 'marcarAceptada', p4, c4, true); ok('tania', 'firmarContrato', p4, HOY_ISO);
  ok('tania', 'guardarFechasEsperadas', p1, [{ orden: 1, etapa: 'Anticipo', fecha: masDias(-45) }, { orden: 2, etapa: 'Avance', fecha: masDias(-3) },
    { orden: 3, etapa: 'Entrega', fecha: masDias(20) }]);
  ok('tania', 'guardarFechasEsperadas', p2, [{ orden: 1, etapa: 'Anticipo', fecha: masDias(-95) }]);
  pagar(p1, 3000, 1); pagar(p1, 2500, 2); pagar(p1, 1000, 1); // el excedente del anticipo pasa a la siguiente
  pagar(p2, 1000, 3); pagar(p2, 18000, 1, 'MXN', 18.25);
  const cancelable = pagar(p4, 1000, 1).folio;
  ok('tania', 'cancelarPago', cancelable, 'Se registró dos veces');
  pagar(p4, 500, 1);
  // Desbloqueo con pagos, otra aceptada y otra vez firmado
  ok('efrain', 'desbloquearContrato', p4, 'Se firmó con la cotización equivocada');
  ok('tania', 'marcarAceptada', p4, c4b, true); ok('tania', 'firmarContrato', p4, HOY_ISO);
  pagar(p4, 3560.5, 3); // liquida (0.50 de más, dentro de la tolerancia) con el excedente de vuelta a las etapas anteriores

  const nombreDe = { [p1]: 'p1', [p2]: 'p2', [p3]: 'p3', [p4]: 'p4' };
  const Lc = libros[props.COBRANZA_DB_ID];
  const aplicaciones = {};
  Lc.pest.Pagos.m.slice(1).forEach(r => { (aplicaciones[nombreDe[r[3]]] = aplicaciones[nombreDe[r[3]]] || []).push([r[4], r[7], r[11], r[12], r[13], r[18]]); });
  [p1, p2, p3, p4].forEach(pf => {
    const v = ok('tania', 'getCobranzaProyecto', pf);
    salida.servidor[nombreDe[pf]] = {
      resumen: v.resumen ? res(v.resumen) : null,
      esquema: v.esquema.map(e => solo(e, ['etapa', 'porcentaje'])),
      pagos: v.pagos.map(p => solo(p, ['monto', 'monedaPago', 'tipoCambio', 'montoAplicado', 'monedaProyecto', 'etapaOrden', 'etapa', 'estado'])),
      banderas: solo(v, ['esquemaEditable', 'esquemaPideMotivo', 'puedeAceptar', 'puedeFirmar', 'puedePagar', 'puedeDesbloquear', 'fechasEditables']),
      esquemasHoja: Lc.pest.Esquemas.m.slice(1).filter(r => r[0] === pf).map(r => [r[1], r[2], r[3], r[4]]),
      aplicaciones: aplicaciones[nombreDe[pf]] || [],
    };
  });
  const rs = ok('tania', 'resumenCobranzaGeneral');
  salida.servidor.resumenGeneral = { totales: rs.totales.map(t => solo(t, RG_TOT)),
    proyectos: rs.proyectos.map(p => Object.assign(solo(p, RG_FILA.filter(k => k !== 'folio' && k !== 'ultimoPago')), { p: nombreDe[p.folio] })) };
  const rc = ok('tania', 'reporteCxc');
  salida.servidor.cxc = { totales: rc.totales, grupos: rc.grupos.map(g => Object.assign(solo(g, ['nombreGrupo', 'moneda', 'vencido', 'total']),
    { detalle: g.detalle.map(x => ({ p: nombreDe[x.folio], total: x.total, partidas: x.partidas.map(p => solo(p, ['orden', 'etapa', 'montoEtapa', 'pagadoEtapa', 'monto', 'dias', 'rango'])) })) })) };
  return sinAnio(salida);
}

module.exports = escenario;
if (require.main === module) process.stdout.write(JSON.stringify(escenario(process.argv[2] || '.'), null, 1) + '\n');
