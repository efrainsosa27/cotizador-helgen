// Incremento 4 (base): roles de CAPRI. Permisos (libro de Administración) o, antes de prepararCapri, Script Properties con
// los mismos permisos de siempre; super admin raíz (SUPER_ADMIN); delegaciones por fechas; @helgen.services solo con
// "Solo requisiciones"; cuenta desactivada = ACCESO en su siguiente clic; ventas para cotizar; sitios con código.
// Uso: node tests/permisos.test.js .
const assert = require('assert');
const dir = process.argv[2] || '.';
const A = require('./arnes')(dir, { props: {
  ROL_COBRANZA: 'efrain@helgen.tech, tania@helgen.tech', ADMIN_DESBLOQUEO: 'efrain@helgen.tech',
  ROL_COMPRAS: 'efrain@helgen.tech, tania@helgen.tech, leo@helgen.tech, mixta@helgen.tech',
  ROL_REQUISICION: 'obrero@helgen.tech, leo@helgen.tech', SOLO_REQUISICION: 'rosa@helgen.tech, adri@helgen.tech, mixta@helgen.tech',
  ROL_OPERACIONES: 'adri@helgen.tech' } });
const { P, ok, falla, plain, props, HOY_ISO, masDias, correr, como } = A;
const SITIOS_INICIALES = correr('SITIOS_INICIALES');
A.tokens.mixta = A.claims('mixta@helgen.tech', 'Mixta', 'SoloYCompras');

// ---- Lógica pura ----
assert.equal(P.correoCapri(' Ana@Helgen.TECH '), 'ana@helgen.tech');
assert.equal(P.correoCapri('jesus@helgen.services'), 'jesus@helgen.services');
assert.equal(P.correoCapri('x@gmail.com'), '');
assert.deepEqual(plain(P.correosCapri('a@helgen.tech; b@helgen.services, c@gmail.com a@helgen.tech')), ['a@helgen.tech', 'b@helgen.services']);
assert.deepEqual(plain(P.rolesDeTexto('Compras, aprobaciones, Solo requisiciones, super admin, nada')),
  ['solo_requisicion', 'aprobaciones', 'compras', 'superadmin']);
assert.deepEqual(plain(P.rolesDeTexto(['ventas', 'Cobranza'])), ['ventas', 'cobranza']);

const u = P.normalizarUsuario({ correo: 'Jesus@helgen.services', nombre: '  Jesús  Honorato ', roles: '', sitio: 'zlo' });
assert.deepEqual(plain(u), { correo: 'jesus@helgen.services', nombre: 'Jesús Honorato', metodo: 'codigo', roles: ['solo_requisicion'],
  sitio: 'ZLO', activo: true, notas: '' });
assert.throws(() => P.normalizarUsuario({ correo: 'j@helgen.services', nombre: 'J', roles: 'compras' }), /solo pueden tener "Solo requisiciones"/);
assert.throws(() => P.normalizarUsuario({ correo: 'a@helgen.tech', nombre: 'A', roles: 'solo_requisicion, compras' }), /no se combina con Compras/);
assert.deepEqual(plain(P.normalizarUsuario({ correo: 'a@helgen.tech', nombre: 'A', roles: 'solo_requisicion, aprobaciones, requisicion' }).roles),
  ['solo_requisicion', 'aprobaciones']);
assert.throws(() => P.normalizarUsuario({ correo: 'a@helgen.tech', nombre: 'A', roles: '' }), /al menos un rol/);
assert.throws(() => P.normalizarUsuario({ correo: 'a@helgen.tech', nombre: '', roles: 'ventas' }), /nombre/);
assert.throws(() => P.normalizarUsuario({ correo: 'a@helgen.tech', nombre: 'A', roles: 'ventas', sitio: 'Veracruz' }), /3 letras/);
assert.equal(P.normalizarUsuario({ correo: 'a@helgen.tech', nombre: 'A', roles: 'ventas', activo: 'No' }).activo, false);

// Script Properties de antes → los mismos permisos
const leg = plain(P.usuariosDesdePropiedades(props));
assert.deepEqual(leg['efrain@helgen.tech'].roles, ['ventas', 'compras', 'cobranza', 'desbloqueo']);
assert.deepEqual(leg['rosa@helgen.tech'].roles, ['solo_requisicion'], 'solo requisiciones no cotiza');
assert.deepEqual(leg['adri@helgen.tech'].roles, ['solo_requisicion', 'aprobaciones']);
assert.deepEqual(leg['mixta@helgen.tech'].roles, ['solo_requisicion'], 'SOLO manda sobre compras');
assert.deepEqual(leg['obrero@helgen.tech'].roles, ['ventas', 'requisicion']);

// rolesEfectivos
const usuarios = P.usuariosDesdeFilas([
  ['leo@helgen.tech', 'Leo', 'google', 'ventas, compras', 'QRO', 'Sí'],
  ['tania@helgen.tech', 'Tania', 'google', 'Compras, Cobranza', '', 'Sí'],
  ['adri@helgen.tech', 'Adriana', 'google', 'Solo requisiciones, Aprobaciones', '', 'Sí'],
  ['jesus@helgen.services', 'Jesús', 'codigo', 'solo_requisicion, compras', 'ZLO', 'Sí'],
  ['baja@helgen.tech', 'Baja', 'google', 'ventas', '', 'No'],
  ['', 'vacía'], ['no-es-correo', 'x'],
]);
assert.deepEqual(Object.keys(usuarios).sort(), ['adri@helgen.tech', 'baja@helgen.tech', 'jesus@helgen.services', 'leo@helgen.tech', 'tania@helgen.tech']);
const dels = P.delegacionesDesdeFilas([
  ['DEL-1', 'tania@helgen.tech', 'leo@helgen.tech', HOY_ISO, masDias(3), 'compras, cobranza', 'Activa'],
  ['DEL-2', 'adri@helgen.tech', 'leo@helgen.tech', masDias(1), masDias(5), 'aprobaciones', 'Activa'],
  ['DEL-3', 'adri@helgen.tech', 'tania@helgen.tech', masDias(-5), masDias(5), 'aprobaciones', 'Cancelada'],
  ['DEL-4', 'adri@helgen.tech', 'ana@helgen.tech', masDias(-1), HOY_ISO, 'aprobaciones', 'Activa'],
]);
assert.deepEqual(plain(dels[0].roles), ['compras'], 'cobranza no se delega');
const ctxR = { usuarios, delegaciones: dels, hoy: HOY_ISO, superAdmins: ['root@helgen.tech'], soloListados: false };
const R = c => plain(P.rolesEfectivos(c, ctxR));
assert.deepEqual(R('leo@helgen.tech').roles, ['ventas', 'compras'], 'tania le delega compras (que leo ya tenía); aprobaciones empieza mañana');
assert.deepEqual(R('ana@helgen.tech'), { activo: true, listado: false, roles: ['ventas', 'aprobaciones'], superadmin: false,
  delegaciones: [{ de: 'adri@helgen.tech', roles: ['aprobaciones'], hasta: HOY_ISO }] }, 'no listada: ventas + lo delegado hoy');
assert.deepEqual(R('tania@helgen.tech').roles, ['compras', 'cobranza'], 'delegación cancelada no cuenta');
assert.deepEqual(R('adri@helgen.tech').roles, ['requisicion', 'solo_requisicion', 'aprobaciones']);
assert.deepEqual(R('jesus@helgen.services').roles, ['requisicion', 'solo_requisicion'], '@helgen.services: solo requisiciones aunque la fila diga compras');
assert.deepEqual(R('baja@helgen.tech'), { activo: false, listado: true, roles: [], superadmin: false, delegaciones: [] });
assert.equal(R('otro@helgen.services').activo, false, '@helgen.services sin alta no entra');
assert.equal(R('x@gmail.com').activo, false);
const root = R('root@helgen.tech');
assert.equal(root.superadmin, true);
assert.deepEqual(root.roles, ['ventas', 'requisicion', 'aprobaciones', 'compras', 'cobranza', 'desbloqueo', 'superadmin']);
assert.equal(P.rolesEfectivos('ana@helgen.tech', Object.assign({}, ctxR, { soloListados: true })).roles.length, 0, 'solo listados');
// Super admin por fila (aunque esté también en otra lista) y un super admin raíz desactivado en la hoja sigue entrando
const u2 = P.usuariosDesdeFilas([['jefa@helgen.tech', 'Jefa', '', 'superadmin', '', 'Sí'], ['root@helgen.tech', 'Root', '', 'ventas', '', 'No']]);
assert.equal(P.rolesEfectivos('jefa@helgen.tech', { usuarios: u2, delegaciones: [], hoy: HOY_ISO, superAdmins: [] }).superadmin, true);
assert.equal(P.rolesEfectivos('root@helgen.tech', { usuarios: u2, delegaciones: [], hoy: HOY_ISO, superAdmins: ['root@helgen.tech'] }).activo, true);

// Sitios con código
const SD = plain(P.sitiosDetalleDeTexto('Querétaro\nManzanillo (TIMSA),  Ensenada  (EIT);Lázaro Cárdenas (LCT)\nVeracruz (ICAVE)\nMonterrey'));
assert.deepEqual(SD.map(s => s.codigo), ['QRO', 'ZLO', 'ESE', 'LZC', 'VER', '']);
const SN = plain(P.sitiosDetalleDeTexto(SITIOS_INICIALES + '\nver | Veracruz duplicado\nMTY | Monterrey | Av. Siempre Viva 742, Col. Centro'));
assert.deepEqual(SN.map(s => s.codigo + ':' + s.nombre), ['QRO:Querétaro', 'ZLO:Manzanillo (TIMSA)', 'ESE:Ensenada (EIT)', 'LZC:Lázaro Cárdenas (LCT)',
  'VER:Veracruz (ICAVE)', 'VER:Veracruz duplicado', 'MTY:Monterrey']);
assert.equal(SN[6].direccion, 'Av. Siempre Viva 742, Col. Centro', 'la coma de la dirección no parte el sitio');
assert.deepEqual(plain(P.sitiosDeTexto(SITIOS_INICIALES)), ['Querétaro', 'Manzanillo (TIMSA)', 'Ensenada (EIT)', 'Lázaro Cárdenas (LCT)', 'Veracruz (ICAVE)']);
assert.equal(P.codigoDeSitio('manzanillo (timsa)', SN), 'ZLO');
assert.equal(P.codigoDeSitio('mty', SN), 'MTY');
assert.equal(P.codigoDeSitio('', SN), '');

// ---- Sin libro de Administración: Script Properties, igual que antes ----
assert.equal(ok('ana', 'bootstrap').permisos.ventas, true);
assert.deepEqual(plain(ok('rosa', 'bootstrap').permisos), { cobranza: false, desbloqueo: false, compras: false, requisicion: true,
  operaciones: false, flujoOperaciones: true, ventas: false, superadmin: false });
assert.equal(ok('mixta', 'bootstrap').permisos.compras, false);
falla('rosa', 'listarCotizaciones', [''], /solo tiene acceso a Requisiciones/, 'PERMISO');
assert.equal(ok('tania', 'bootstrap').permisos.superadmin, false);

// ---- prepararCapri: libro de Administración privado, roles copiados a Permisos, SUPER_ADMIN = leo ----
P.prepararCapri();
assert(props.ADMIN_DB_ID && props.ADMIN_FOLDER_ID, 'libro y carpeta de Administración');
assert.equal(props.SUPER_ADMIN, 'leo@helgen.tech');
const LA = A.libros[props.ADMIN_DB_ID];
assert.deepEqual(Object.keys(LA.pest).sort(), ['Anulaciones', 'Bitacora', 'Correos', 'Delegaciones', 'Permisos']);
assert.equal(A.carpetas[props.ADMIN_FOLDER_ID].acceso, 'PRIVATE', 'la carpeta queda restringida');
assert.equal(A.archivos[props.ADMIN_DB_ID].acceso, 'PRIVATE', 'el libro queda restringido');
const perm = LA.pest.Permisos.m;
assert.deepEqual(perm[0], ['correo', 'nombre', 'metodo', 'roles', 'sitio', 'activo', 'notas', 'actualizo', 'actualizado']);
const fila = c => perm.find(r => r[0] === c);
assert.deepEqual(fila('efrain@helgen.tech').slice(0, 6), ['efrain@helgen.tech', '', 'google', 'ventas, compras, cobranza, desbloqueo', '', 'Sí']);
assert.deepEqual(fila('adri@helgen.tech').slice(3, 4), ['solo_requisicion, aprobaciones']);
assert.equal(perm.length, 8, '7 usuarios + encabezado');
P.prepararCapri(); // otra vez: no duplica ni pisa
assert.equal(perm.length, 8);

// Con el libro: los roles salen de Permisos (las propiedades ya no mandan)
props.ROL_COBRANZA = '';
assert.equal(ok('tania', 'bootstrap').permisos.cobranza, true, 'sale de Permisos, no de ROL_COBRANZA');
assert.equal(ok('leo', 'bootstrap').permisos.superadmin, true, 'SUPER_ADMIN raíz');
assert.equal(ok('leo', 'bootstrap').permisos.cobranza, true);
// Quitar ventas a alguien: no cotiza (el servidor lo niega)
fila('tania@helgen.tech')[3] = 'compras, cobranza';
P.subirVersiones_(['permisos']);
assert.equal(ok('tania', 'bootstrap').permisos.ventas, false);
falla('tania', 'guardarCotizacion', [{}], /no tiene acceso a cotizaciones/, 'PERMISO');
// Desactivar: ACCESO en el siguiente clic (sin esperar a que caduque la sesión)
fila('obrero@helgen.tech')[5] = 'No';
P.subirVersiones_(['permisos']);
falla('obrero', 'bootstrap', [], /desactivado/, 'ACCESO');
// Hecho a mano en la hoja (sin subir versión): sincronizar lo detecta por la huella (cada 5 min) y sube la versión
fila('obrero@helgen.tech')[5] = 'Sí';
for (const k of Object.keys(A.cache)) if (/^R_/.test(k)) delete A.cache[k];
const vAntes = Number(props.VER_permisos);
ok('efrain', 'sincronizar', {}, {});
assert(Number(props.VER_permisos) > vAntes, 'la versión de permisos sube');
assert.equal(ok('obrero', 'bootstrap').permisos.requisicion, true);
// Una delegación en la hoja: compras de tania a obrero hoy
LA.pest.Delegaciones.m.push(['DEL-9', 'tania@helgen.tech', 'obrero@helgen.tech', "'" + HOY_ISO, "'" + masDias(2), 'compras', 'Activa', 'tania@helgen.tech', '']);
P.subirVersiones_(['permisos']);
assert.equal(ok('obrero', 'bootstrap').permisos.compras, true, 'compras por delegación');
como(null);
assert.deepEqual(plain(P.rolesEfectivos('obrero@helgen.tech', P.contextoRoles_()).delegaciones), [{ de: 'tania@helgen.tech', roles: ['compras'], hasta: masDias(2) }]);
assert(P.correosConRol_('compras').indexOf('obrero@helgen.tech') !== -1, 'el delegado también recibe los avisos de compras');
assert(P.correosConRol_('compras').indexOf('leo@helgen.tech') !== -1, 'super admin');
// @helgen.services: sin sesión propia todavía (la da el módulo de identidad)
falla('capri.token-falso', 'bootstrap', [], /Inicia sesión/, 'SESION');
// Excepción de super admin: solo con motivo ≥ 10 y queda en la Bitacora
como('leo@helgen.tech', 'Leo');
assert.equal(P.excepcionSuperAdmin_('aprobar lo propio', 'REQ-1', 'corto'), false);
assert.equal(P.excepcionSuperAdmin_('aprobar lo propio', 'REQ-1', 'Urgente: Adriana de vacaciones'), true);
assert.equal(LA.pest.Bitacora.m.slice(-1)[0][2], 'Excepción de super admin: aprobar lo propio');
como('tania@helgen.tech', 'Tania');
assert.equal(P.excepcionSuperAdmin_('aprobar lo propio', 'REQ-1', 'Urgente: Adriana de vacaciones'), false, 'no es super admin');
como(null);
console.log('OK permisos');
