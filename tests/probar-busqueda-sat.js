const fs=require('fs'),vm=require('vm');
const ctx={console};vm.createContext(ctx);vm.runInContext(fs.readFileSync(process.argv[2],'utf8'),ctx);
function csv(t){return t.trim().split('\n').slice(1).map(l=>{const m=l.match(/^([^,]*),(.*)$/);return [m[1],m[2].replace(/^"|"$/g,'').replace(/""/g,'"')]})}
const filas=csv(fs.readFileSync(process.argv[3],'utf8'));
const qs=['Panel solar 550 W','Inversor híbrido 5 kW','Cargador para vehículo eléctrico 7 kW','Estación de carga para auto eléctrico',
 'Instalación de paneles solares','Mantenimiento preventivo','Cable de cobre calibre 10','Servicio de rastreo GPS vehicular',
 'Limpieza de patios','Batería de litio','Estructura de aluminio para paneles','Centro de carga','Mano de obra eléctrica'];
console.time('13 búsquedas');
for(const q of qs){const r=ctx.buscarClavesSat(q,filas,5);console.log('\n» '+q);r.forEach(x=>console.log('   '+x.clave+'  '+x.puntaje.toFixed(2)+'  '+x.descripcion))}
console.timeEnd('13 búsquedas');
