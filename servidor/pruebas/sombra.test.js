// La herramienta de sombra (herramientas/sombra.js) contra dos servidores en memoria con los mismos datos (el escenario
// de paridad corrido en los dos): todo igual. Luego una edición a mano en uno: la sombra la reporta como distinta.
// Uso: node pruebas/sombra.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { levantar, correrEscenario, tokensDeArnes, REPO } = require('./apoyo');
const { escenario, PROPS } = require('./escenario');

const correrSombra = (a, b) => new Promise(resolve => {
  const h = spawn(process.execPath, [path.join(__dirname, '..', 'herramientas', 'sombra.js'), '--apps', 'http://127.0.0.1:' + a.puerto + '/api',
    '--servidor', 'http://127.0.0.1:' + b.puerto + '/api', '--detalles', '3'], { env: Object.assign({}, process.env, { CAPRI_TOKEN: 'efrain' }) });
  let salida = '';
  h.stdout.on('data', d => { salida += d; });
  h.stderr.on('data', d => { salida += d; });
  h.on('close', codigo => resolve({ codigo, salida }));
});

(async () => {
  const A0 = require(path.join(REPO, 'tests', 'arnes.js'))(REPO, { props: PROPS });
  const T = Date.now();
  const tokens = tokensDeArnes(A0);
  const [X, Y] = await Promise.all([levantar({ props: PROPS, tokens, relojFijo: T }), levantar({ props: PROPS, tokens, relojFijo: T })]);
  try {
    for (const S of [X, Y]) await correrEscenario(escenario(T), (q, f, ...a) => S.post(q, f, ...a));
    const r1 = await correrSombra(X, Y);
    assert.equal(r1.codigo, 0, r1.salida);
    assert(/(\d+) de \1 iguales/.test(r1.salida), r1.salida);
    // Alguien cambia a mano el nombre del proyecto en una copia: la sombra lo encuentra
    Y.conductor.editarAMano('DB', l => { l.hojas.find(h => h.titulo === 'Proyectos').valores[1][2] = 'Casa del Lago (editado)'; });
    await Y.servicio.espejo.sondear();
    const r2 = await correrSombra(X, Y);
    assert.equal(r2.codigo, 1);
    assert(/DISTINTO/.test(r2.salida) && /Casa del Lago \(editado\)/.test(r2.salida), r2.salida);
    console.log('✔ sombra: ' + r1.salida.match(/\d+ de \d+ iguales/)[0] + ' con los mismos datos; la edición a mano sale como distinta');
  } finally {
    await X.cerrar(); await Y.cerrar();
  }
})().catch(e => { console.error(e); process.exit(1); });
