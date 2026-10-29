// Arma el servicio completo (sin HTTP): almacenes, candado, espejo canónico, Drive, salida HTTP, correo, PDF,
// activadores y el grupo de trabajadores. Lo usan src/index.js (producción) y las pruebas (en el mismo proceso).
'use strict';
const fs = require('fs');
const path = require('path');
const { Candado } = require('./nucleo/candado');
const { Propiedades, Cache, Estado, asegurarCarpeta } = require('./nucleo/almacen');
const { EspejoCentral } = require('./nucleo/espejo-central');
const { ServicioDrive, crearSalida, ServicioCorreo, MotorPdf, Activadores } = require('./nucleo/servicios');
const { Pool } = require('./pool');
const { crearRegistro } = require('./nucleo/registro');

const MARCA_TOKEN = 'token-del-servidor-capri';

/** Colecciones de CAPRI que viven en cada libro (por la propiedad que guarda su id): al editarlo a mano, suben. */
const COLECCIONES_POR_LIBRO = {
  SPREADSHEET_ID: ['proyectos', 'cotizaciones'], CATALOGO_ID: ['catalogo'], COBRANZA_DB_ID: ['contratos', 'pagosCobranza'],
  COMPRAS_DB_ID: ['requisiciones', 'oc', 'pagosProveedores', 'facturasProveedor'], ADMIN_DB_ID: ['permisos', 'anulaciones'],
};

function clientIdDeCode(archivo) {
  const m = fs.readFileSync(archivo, 'utf8').match(/const CLIENT_ID_GOOGLE = '([^']+)'/);
  return m ? m[1] : null;
}

/**
 * @param {object} conf  ver config.ejemplo.json
 * @param {object} piezas  {conductor, identidad, registro?}
 */
function crearServicio(conf, piezas) {
  const registro = piezas.registro || crearRegistro(conf.registro);
  const datos = conf.datos ? asegurarCarpeta(conf.datos) : null;
  const archivo = n => (datos ? path.join(datos, n) : null);
  const props = new Propiedades(archivo('propiedades.json'), conf.propiedadesIniciales);
  if (props.leer('API_MUDADA') && !conf.permitirApiMudada) {
    throw new Error('Las propiedades tienen API_MUDADA (la marca que apaga Apps Script en el cambio). Quítala del archivo del servidor.');
  }
  const cache = new Cache(archivo('cache.json'));
  const estado = new Estado(archivo('estado.json'));
  const conductor = piezas.conductor;
  const soloLectura = !!conf.soloLectura;
  let pool = null;
  let espejo = null;

  const subirVersiones = cols => {
    if (!cols.length) return;
    const cambios = {};
    cols.forEach(c => { cambios['VER_' + c] = String((Number(props.leer('VER_' + c)) || 0) + 1); });
    props.escribir(cambios);
  };
  const candado = new Candado({ registro,
    // Antes de entregar el candado: si hace rato que no se revisa Drive, se revisa (ediciones a mano recientes)
    alEntregar: async () => {
      if (espejo && conf.frescuraSeg > 0 && Date.now() - espejo.ultimoSondeo > conf.frescuraSeg * 1000) {
        const ids = [...espejo.libros.keys()];
        const versiones = await Promise.all(ids.map(id => conductor.versionLibro(id).catch(() => null)));
        espejo.ultimoSondeo = Date.now();
        for (let i = 0; i < ids.length; i++) {
          const x = espejo.libros.get(ids[i]);
          if (versiones[i] != null && x && !x.pidiendoVersion && String(versiones[i]) !== String(x.version)) await espejo.recargar(ids[i], 'edición reciente', true);
        }
      }
    } });
  const nombreDe = id => { const x = espejo && espejo.libros.get(id); return x ? '"' + x.libro.titulo + '"' : id; };
  espejo = new EspejoCentral({ conductor, candado, registro, soloLectura,
    difundir: (libros, excepto, olvidar) => pool && pool.difundir(libros, excepto, olvidar),
    alCambioExterno: id => {
      const p = props.todas();
      const cols = Object.keys(COLECCIONES_POR_LIBRO).filter(k => p[k] === id).reduce((a, k) => a.concat(COLECCIONES_POR_LIBRO[k]), []);
      subirVersiones(cols);
      // Las fuentes que se editan a mano (fuenteConHuella_) se releen en la siguiente consulta de los navegadores
      cache.borrarPrefijos(['R_']);
    } });
  const drive = new ServicioDrive({ conductor, ttlMs: conf.driveTtlMs, soloLectura });
  const identidad = piezas.identidad;
  const salida = crearSalida({ identidad, conductor, marcaToken: MARCA_TOKEN, soloLectura, registro });
  const correo = new ServicioCorreo({ conductor, estado, limiteDiario: conf.correoLimiteDiario, zona: conf.zonaHoraria, soloLectura, registro });
  const pdf = conductor.pdf ? { html: h => conductor.pdf(h), cerrar: async () => {} } : new MotorPdf(conf.pdf);
  const activadores = new Activadores({ estado, registro, habilitados: !soloLectura && conf.activadores !== false,
    ejecutar: funcion => pool.ejecutar({ funcion, args: [], clase: 'activador' }).then(r => {
      registro('info', 'activador', { funcion, ms: Math.round(r.metricas.ms || 0), texto: String(r.texto).slice(0, 500) });
      return r;
    }) });

  /** Lo que pide un trabajador por el puente. */
  async function atender(tipo, d, t) {
    const dueno = pool.dueno(t);
    switch (tipo) {
      case 'hojas.abrir': return espejo.abrir(String(d.id));
      case 'hojas.crear': return espejo.crear(d.nombre);
      case 'tx.confirmar': {
        const hacer = async () => {
          const r = await espejo.confirmar(d.libros, { trabajador: t.numero, nombreDe });
          // Propiedades y caché son del servidor (en la corrida de sombra son su propia copia): se aplican siempre
          if (d.props && (d.props.borrarTodo || Object.keys(d.props.cambios || {}).length)) props.escribir(d.props.cambios, d.props.borrarTodo);
          if (d.cache && d.cache.length) cache.escribir(d.cache);
          return r;
        };
        if (d.conCandado) {
          if (candado.dueno !== dueno) throw new Error('Confirmación sin el candado (' + dueno + ').');
          return hacer();
        }
        return candado.con(dueno + ':confirmar', hacer);
      }
      case 'candado.tomar': return candado.tomar(dueno, d.ms);
      case 'candado.soltar': return candado.soltar(dueno);
      case 'props.leer': return props.leer(d.clave);
      case 'props.todas': return props.todas();
      case 'props.escribir': props.escribir(d.cambios, d.borrarTodo); return true;
      case 'cache.leer': return cache.leer(d.claves);
      case 'cache.escribir': cache.escribir(d.pares); return true;
      case 'url.fetch': return salida(d);
      case 'correo.enviar': return correo.enviar(d);
      case 'correo.cuota': return correo.cuota();
      case 'pdf.html': return pdf.html(d.html);
      case 'activadores.listar': return activadores.listar();
      case 'activadores.crear': return activadores.crear(d);
      case 'activadores.borrar': return activadores.borrar(d);
      default:
        if (tipo.startsWith('drive.')) {
          const f = tipo.slice(6);
          if (typeof drive[f] !== 'function') throw new Error('Operación de Drive desconocida: ' + f);
          return drive[f](d);
        }
        throw new Error('Petición interna desconocida: ' + tipo);
    }
  }

  const archivosCodigo = (conf.codigo && conf.codigo.archivos) || [path.join(conf.codigo.dir, 'Logo.js'), path.join(conf.codigo.dir, 'Code.js')];
  pool = new Pool({ n: conf.trabajadores, atender, registro, limiteMs: conf.limiteMs, limiteActivadorMs: conf.limiteActivadorMs,
    confTrabajador: { archivos: archivosCodigo, plantillas: conductor.plantillas, zona: conf.zonaHoraria, cuentaServicio: conf.cuentaServicio,
      marcaToken: MARCA_TOKEN, silencioso: !!conf.silencioso, memoriaMb: conf.memoriaTrabajadorMb, idScript: conf.idScript,
      relojFijo: conf.relojFijo || null, escrituraInmediata: !!conf.escrituraInmediata },
    alMorir: async (t, dueno) => { candado.soltar(dueno); } });

  const timers = [];
  return {
    conf, props, cache, estado, candado, espejo, drive, correo, pdf, activadores, pool, registro, conductor, identidad,
    clientId: clientIdDeCode(archivosCodigo[archivosCodigo.length - 1]),
    async iniciar() {
      await pool.iniciar();
      // Precarga de los libros conocidos (así el primer clic no espera a Google)
      const ids = Object.keys(COLECCIONES_POR_LIBRO).concat(conf.precargarExtra || []).map(k => props.leer(k)).filter(Boolean);
      if (conf.precargar !== false) await Promise.all(ids.map(id => espejo.abrir(id).catch(e => registro('aviso', 'no se precargó ' + id + ': ' + e.message))));
      activadores.iniciar();
      if (conf.sondeoSeg > 0) timers.push(setInterval(() => espejo.sondear().catch(e => registro('aviso', 'sondeo: ' + e.message)), conf.sondeoSeg * 1000));
      if (conf.reconciliarMin > 0) timers.push(setInterval(() => espejo.reconciliar().catch(e => registro('aviso', 'reconciliación: ' + e.message)), conf.reconciliarMin * 60000));
      timers.push(setInterval(() => { try { cache.guardar(); } catch (e) { registro('error', 'caché: ' + e.message); } }, 30000));
      timers.forEach(x => x.unref());
    },
    /** Una petición del navegador (cuerpo de texto como el de doPost). */
    peticion(cuerpo) {
      const m = /"funcion"\s*:\s*"([A-Za-z0-9_]{1,80})"/.exec(cuerpo.slice(0, 400));
      const funcion = m ? m[1] : '';
      const escribe = pool.cambiosApi.has(funcion) || !funcion;
      if (soloLectura && pool.cambiosApi.has(funcion)) {
        return Promise.resolve({ texto: JSON.stringify({ ok: false, error: 'Servidor en modo solo lectura (corrida de sombra): ' + funcion + ' no se ejecuta.', codigo: 'SOLO_LECTURA' }), metricas: { msCola: 0 }, funcion });
      }
      return pool.ejecutar({ cuerpo, funcion, clase: escribe ? 'escritura' : 'lectura' }).then(r => Object.assign(r, { funcion }));
    },
    salud() {
      return { ok: true, servicio: 'capri', backend: conductor.nombre, soloLectura, trabajadores: pool.estado(), candado: candado.estado(),
        libros: espejo.estado(), espejo: espejo.metricas, cache: cache.tamano, correoCuota: correo.cuota(), activadores: activadores.listar().map(a => a.funcion),
        sesiones: identidad.metricas, memoriaMb: Math.round(process.memoryUsage().rss / 1048576) };
    },
    async detener() {
      timers.forEach(x => clearInterval(x));
      activadores.detener();
      await pool.cerrar(conf.msApagado || 30000);
      try { cache.sucio = true; cache.guardar(); } catch (e) { registro('error', 'caché al apagar: ' + e.message); }
      await pdf.cerrar();
    },
  };
}

module.exports = { crearServicio, COLECCIONES_POR_LIBRO, MARCA_TOKEN, clientIdDeCode };
