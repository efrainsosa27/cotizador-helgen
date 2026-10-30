#!/usr/bin/env node
// CAPRI — servicio de la etapa 1. Uso: node src/index.js [/etc/capri/capri.json]   (o CAPRI_CONFIG=…)
// Ver docs/servidor-etapa-1.md y servidor/config.ejemplo.json.
'use strict';
const fs = require('fs');
const path = require('path');

const archivoConf = process.argv[2] || process.env.CAPRI_CONFIG || '/etc/capri/capri.json';
const conf = Object.assign({
  puerto: 8090, host: '127.0.0.1', origenes: [], backend: 'google', zonaHoraria: 'America/Mexico_City',
  cuentaServicio: 'facilities@helgen.tech', trabajadores: 3, limiteMs: 120000, limiteActivadorMs: 300000,
  sondeoSeg: 60, reconciliarMin: 10, frescuraSeg: 15, driveTtlMs: 60000, correoLimiteDiario: 1500, soloLectura: false,
  limiteBytes: 50 * 1024 * 1024, memoriaTrabajadorMb: 768,
}, JSON.parse(fs.readFileSync(archivoConf, 'utf8')));
// En Docker el servicio escucha en todas las interfaces DEL CONTENEDOR (docker-compose.yml publica solo 127.0.0.1:8090 del
// servidor); el archivo de configuración se queda con 127.0.0.1, lo seguro fuera de un contenedor.
if (process.env.CAPRI_HOST) conf.host = process.env.CAPRI_HOST;
if (process.env.CAPRI_PUERTO) conf.puerto = Number(process.env.CAPRI_PUERTO);
// Zona horaria de Apps Script (appsscript.json): new Date(a, m, d) y getHours() de Code.js dependen de ella
process.env.TZ = conf.zonaHoraria;

const { crearServicio, clientIdDeCode } = require('./servicio');
const { crearServidorHttp } = require('./http');
const { crearRegistro } = require('./nucleo/registro');
const { VerificadorGoogle, VerificadorTabla } = require('./nucleo/identidad');

async function principal() {
  const registro = crearRegistro(conf.registro);
  const codigoDir = (conf.codigo && conf.codigo.dir) || path.join(__dirname, '..', '..');
  conf.codigo = Object.assign({ dir: codigoDir }, conf.codigo);
  const clientId = conf.clientIdGoogle || clientIdDeCode(path.join(codigoDir, 'Code.js'));
  let conductor, identidad;
  if (conf.backend === 'memoria') {
    const { ConductorMemoria } = require('./backends/memoria');
    conductor = new ConductorMemoria({});
    const iniciales = conductor.sembrarComoArnes();
    conf.propiedadesIniciales = Object.assign(iniciales, conf.propiedadesIniciales || {});
    identidad = new VerificadorTabla(conf.tokensPrueba || {});
    registro('aviso', 'backend memoria: datos de prueba en memoria (nada va a Google)');
  } else {
    const { crearConductorGoogle } = require('./backends/google');
    conductor = crearConductorGoogle(Object.assign({ sujeto: conf.cuentaServicio, remitente: conf.cuentaServicio }, conf.google));
    identidad = new VerificadorGoogle({ clientId });
  }
  const servicio = crearServicio(conf, { conductor, identidad, registro });
  await servicio.iniciar();
  const servidor = crearServidorHttp(servicio, { origenes: conf.origenes, limiteBytes: conf.limiteBytes });
  servidor.listen(conf.puerto, conf.host, () => registro('info', 'CAPRI escuchando', { host: conf.host, puerto: conf.puerto, backend: conductor.nombre,
    trabajadores: conf.trabajadores, soloLectura: !!conf.soloLectura }));

  let apagando = false;
  const apagar = async senal => {
    if (apagando) return;
    apagando = true;
    registro('info', 'apagando (' + senal + ')');
    servidor.close();
    await servicio.detener();
    registro('info', 'apagado');
    process.exit(0);
  };
  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));
}

principal().catch(e => {
  process.stderr.write('No arrancó CAPRI: ' + (e && e.stack || e) + '\n');
  process.exit(1);
});
