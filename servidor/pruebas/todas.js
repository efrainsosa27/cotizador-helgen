// Todas las pruebas del servidor (npm test). Cada una corre en su propio proceso.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const pruebas = ['unidades', 'google', 'identidad', 'paridad', 'servidor', 'sombra'];
let fallas = 0;
for (const n of pruebas) {
  const r = spawnSync(process.execPath, [path.join(__dirname, n + '.test.js')], { encoding: 'utf8', env: Object.assign({}, process.env, { TZ: 'America/Mexico_City' }), timeout: 300000 });
  if (r.status === 0) {
    console.log('✔ servidor/' + n);
  } else {
    fallas++;
    console.log('✘ servidor/' + n);
    console.log(String(r.stdout || '').split('\n').filter(l => /✘|Error|assert/i.test(l)).slice(0, 15).join('\n'));
    console.log(String(r.stderr || '').split('\n').slice(0, 15).join('\n'));
  }
}
process.exit(fallas ? 1 : 0);
