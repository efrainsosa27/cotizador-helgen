// Regresiones de la revisión independiente del incremento 4 (28/10/2026), una sección por hallazgo: el flujo de aprobaciones
// no se apaga al desactivar a quien aprueba; nadie autoriza lo suyo (solo super admin con motivo); @helgen.services nunca super admin; delegaciones sin encadenar;
// topes globales de la entrada con código; argumentos de onclick seguros. (Las sesiones revocables están en identidad.test.js,
// las notas fuera de los correos en correos.test.js y lo del centro de mando en centro.test.js.)
// Uso: node tests/revision.test.js .
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {
  ROL_COMPRAS: 'efrain@helgen.tech, tania@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech, tania@helgen.tech',
  SOLO_REQUISICION: 'adri@helgen.tech, jesus@helgen.services',
  ROL_OPERACIONES: 'adri@helgen.tech', SUPER_ADMIN: 'leo@helgen.tech' } });
const { P, ok, falla, plain, props, HOY_ISO, masDias, correr, PDF } = A;
correr('var AVISOS_ = []; enviarCorreosPendientes_ = function () { AVISOS_.push.apply(AVISOS_, MEMO_.correos || []); MEMO_.correos = []; };');
P.prepararCapri();
const usuario = c => ok('leo', 'listarUsuarios').usuarios.find(u => u.correo === c);
const flujo = () => correr('MEMO_ = {}; flujoOperaciones_()');

// ---- Una cuenta @helgen.services nunca es super admin (ni por la hoja ni por SUPER_ADMIN) ----
const ctx = { usuarios: P.usuariosDesdeFilas([['x@helgen.services', 'X', 'codigo', 'solo_requisicion, superadmin', '', 'Sí'],
  ['y@helgen.services', 'Y', 'codigo', 'solo_requisicion', '', 'Sí']]), delegaciones: [], hoy: HOY_ISO,
  superAdmins: ['y@helgen.services', 'leo@helgen.tech'] };
for (const c of ['x@helgen.services', 'y@helgen.services']) {
  const r = plain(P.rolesEfectivos(c, ctx));
  assert(!r.superadmin && r.roles.indexOf('compras') === -1 && r.roles.indexOf('cobranza') === -1, c + ': ' + r.roles);
}
assert.equal(P.rolesEfectivos('leo@helgen.tech', ctx).superadmin, true);

// ---- Desactivar al único con Aprobaciones no apaga el flujo (compras no autoriza sin aprobación) ----
assert.equal(flujo(), true);
const pry = ok('leo', 'crearProyecto', { nombre: 'Revisión', ubicacion: 'Querétaro', cliente: { nombre: 'Cliente' }, idSolicitud: 'p1' }).folio;
let n = 0;
const req = (quien, extra) => ok(quien, 'guardarRequisicion', Object.assign({ proyectoFolio: pry, sitio: 'Querétaro',
  renglones: [{ descripcion: 'Brida', cantidad: 4 }], cotizacion: { nombre: 'c.pdf', datos: PDF }, idSolicitud: 'r' + (++n) }, extra || {})).folio;
const OC = () => ({ proveedor: { razonSocial: 'Eléctrica del Centro' }, fechaEntrega: masDias(2), formaPago: 'Transferencia', condicionesPago: 'Contado', diasCredito: 0,
  ivaTasa: 0.16, renglones: [{ descripcion: 'Brida', unidad: 'PZA', cantidad: 4, costo: 100 }], idSolicitud: 'oc' + (++n) });
const adri = Object.assign(usuario('adri@helgen.tech'), { nombre: 'Adriana' }); // los migrados llegan sin nombre
ok('leo', 'guardarUsuario', Object.assign({}, adri, { activo: false }));
assert.equal(flujo(), true, 'sigue encendido');
const rT = req('tania');
falla('tania', 'autorizarRequisicion', [rT, OC()], /flujo de operaciones/);
// Quitar el rol a propósito sí lo apaga (flujo de siempre)
ok('leo', 'guardarUsuario', Object.assign({}, adri, { activo: true, roles: ['solo_requisicion'] }));
assert.equal(flujo(), false);

// ---- Flujo de siempre: nadie autoriza lo que pidió; solo un super admin, con motivo (decisión de Leo, 29/10/2026) ----
const rT2 = req('tania');
let e = falla('tania', 'autorizarRequisicion', [rT2, OC()], /tu propia requisición/, 'PERMISO');
assert(!/super admin/.test(e.error), 'a quien no es super admin no se le ofrece la excepción');
falla('tania', 'autorizarRequisicion', [rT2, OC(), 'Motivo largo pero no es super admin'], /tu propia requisición/, 'PERMISO');
assert(/^OC-/.test(ok('efrain', 'autorizarRequisicion', rT2, OC()).ocFolio), 'otra persona de compras sí');
const rL = req('leo');
e = falla('leo', 'autorizarRequisicion', [rL, OC()], /Como super admin puedes hacerlo/, 'PERMISO');
falla('leo', 'autorizarRequisicion', [rL, OC(), 'corto'], /tu propia requisición/, 'PERMISO');
assert(/^OC-/.test(ok('leo', 'autorizarRequisicion', rL, OC(), 'Nadie más de compras está hoy').ocFolio));
const bitAdmin = A.libros[props.ADMIN_DB_ID].pest.Bitacora.m;
assert.deepEqual(bitAdmin[bitAdmin.length - 1].slice(1, 6), ['leo@helgen.tech', 'Excepción de super admin: autorizar su propia requisición', rL, '',
  'Nadie más de compras está hoy']);

// ---- Delegaciones: empiezan a más tardar en 30 días y no se encadenan ----
falla('tania', 'crearDelegacion', [{ a: 'obrero@helgen.tech', roles: ['compras'], desde: masDias(31), hasta: masDias(40) }], /a más tardar en 30 días/);
ok('tania', 'crearDelegacion', { a: 'obrero@helgen.tech', roles: ['compras'], desde: HOY_ISO, hasta: masDias(5) });
falla('tania', 'crearDelegacion', [{ a: 'obrero@helgen.tech', roles: ['compras'], desde: masDias(6), hasta: masDias(30) }], /vigente o programada/);

// ---- Entrada con código: topes de todas las cuentas juntas y reserva de la cuota de correo ----
for (let i = 0; i < 30; i++) ok('', 'solicitarCodigo', 'p' + i + '@helgen.services');
falla('', 'solicitarCodigo', ['otra@helgen.services'], /muchos códigos/);
delete A.cache.CAPRI_PED_TODOS;
for (let i = 0; i < 12; i++) for (let k = 0; k < 5; k++) falla('', 'verificarCodigo', ['q' + i + '@helgen.services', '000000'], /incorrecto|Demasiados/);
falla('', 'verificarCodigo', ['fresca@helgen.services', '000000'], /muchos códigos/);
delete A.cache.CAPRI_ERR_TODOS;
correr('MailApp.getRemainingDailyQuota = function () { return 10; };');
const n0 = A.correos.length;
ok('', 'solicitarCodigo', 'jesus@helgen.services');
assert.equal(A.correos.length, n0, 'con la cuota casi agotada, los códigos no la gastan (los avisos van primero)');

// ---- Interfaz: argumentos de onclick que vienen de la hoja (JSON y luego HTML) ----
const html = fs.readFileSync(path.join(dir, 'web/home/index.html'), 'utf8');
const def = html.match(/const esc = [^\n]+\n[^\n]*\n\s*const jsArg = [^\n]+/)[0];
const jsArg = new Function(def + '; return jsArg;')();
const malo = "DEL-1');alert(1);//\"<b>";
const attr = jsArg(malo);
assert(!/[<>"']/.test(attr), 'sin comillas ni etiquetas crudas en el atributo');
const decodificado = attr.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
assert.equal(JSON.parse(decodificado), malo, 'el navegador lo lee como un solo texto de JS');
assert(!/onclick="identidad\.(editarUsuario|cancelarDelegacion)\(\\''/.test(html), 'Permisos y Delegaciones ya no arman el texto a mano');

console.log('OK revisión');
