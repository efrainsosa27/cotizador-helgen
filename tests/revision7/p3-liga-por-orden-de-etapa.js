// Sonda 3: la liga de una factura de cliente guarda la etapa por su NÚMERO de orden ('1', 'HLG-…/1'). Si cobranza cambia el
// esquema (el mini-esquema de una adicional sin pagos, o el del contrato tras un desbloqueo), la factura se queda pegada a la etapa
// que ahora tiene ese número: facturado > monto de la etapa, "por facturar" negativo y nada queda "Por revisar".
// docs/incremento-7-facturas.md §0.1: "Si alguien renombra o quita etapas ... la factura queda «Por revisar» ... nunca se reasigna sola".
'use strict';
const assert = require('assert');
const S = require('./comun')(process.argv[2] || '.');
const { ok, pry, cotizar, firmar, id } = S;
const { cfdi, U, b64 } = require('./cfdi-cliente');

const pA = pry('Planta');
firmar(pA, cotizar(pA, 10000));
const ad = cotizar(pA, 1000, { adicional: true });          // 1,160 con IVA, mini-esquema "Pago único 100 %"
ok('tania', 'aceptarAdicional', pA, ad);
// Helgen factura la adicional completa (1,160, PPD) y cobranza la liga a su etapa
const UF = U(4401);
ok('tania', 'importarFacturasClientes', { archivos: [{ nombre: 'A-201.xml', datos: b64(cfdi({ uuid: UF, folio: '201' })) }], idSolicitud: id('imp') });
const clave = ad + '/1';
ok('tania', 'ligarFacturaCliente', { uuid: UF, proyectoFolio: pA, etapas: [{ clave }] });
// Después (sin pagos todavía) cobranza quiere partir la adicional en dos etapas renombrando la primera. ADAPTADA al arreglo: el
// esquema ya no se puede cambiar así (movería la liga de A-201); el error dice qué factura lo impide
const r = S.post('tania', 'guardarEsquemaAdicional', pA, ad, [{ etapa: 'Anticipo', porcentaje: 50 }, { etapa: 'Finiquito', porcentaje: 50 }]);
console.log('editar el esquema (renombra la etapa ligada):', r.ok ? 'SE GUARDÓ' : 'rechazado → ' + r.error);
assert(!r.ok && /A-201/.test(r.error) && /Pago único/.test(r.error), 'DEFECTO: el esquema cambió y la factura quedó pegada a la etapa que ahora tiene su número');
// Agregar una etapa al final sin renombrar la ligada sí se puede
ok('tania', 'guardarEsquemaAdicional', pA, ad, [{ etapa: 'Pago único', porcentaje: 50 }, { etapa: 'Finiquito', porcentaje: 50 }]);
// Si alguien la renombra a mano en la hoja (o cambia por otro camino), la factura queda «Por revisar» (docs §0.1), sin reasignarse sola
const esq = S.libros[S.props.COBRANZA_DB_ID].pest.Esquemas.m;
const fila = esq.find(x => String(x[6]) === ad && Number(x[1]) === 1);
fila[2] = 'Anticipo';
Object.keys(S.cache).forEach(k => delete S.cache[k]);
const v = ok('tania', 'getCobranzaProyecto', pA);
const et = v.facturas.etapas.filter(e => e.clave.indexOf(ad) === 0).map(e => [e.clave, e.etapa, e.monto, e.facturado, e.porFacturar]);
console.log('etapas de la adicional (clave, etapa, monto, facturado, por facturar):', JSON.stringify(et));
console.log('por revisar:', JSON.stringify(v.facturas.porRevisar));
const lista = ok('tania', 'listarFacturasClientes');
console.log('liga guardada:', JSON.stringify(lista.facturas.find(f => f.uuid === UF).etapas), '· revisar:', JSON.stringify(lista.facturas.find(f => f.uuid === UF).revisar));
assert(v.facturas.porRevisar.length > 0, 'DEFECTO: la factura de "Pago único" (1,160) quedó reasignada sola a "Anticipo" (580): por facturar −580 y sin "Por revisar"');
assert(et.every(e => e[3] === 0), 'DEFECTO: la factura sigue contando en una etapa que ya no es la suya');
const pend = ok('tania', 'pendientes', false);
assert((pend.items || []).some(x => x.tipo === 'facRevisar' && x.uuid === UF), 'DEFECTO: la factura por revisar no sale en Pendientes');
