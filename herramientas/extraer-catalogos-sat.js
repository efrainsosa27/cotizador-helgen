const X=require('xlsx'),fs=require('fs');
const [,,xls,out]=process.argv;
const wb=X.readFile(xls,{sheets:['c_ClaveProdServ','c_ClaveUnidad']});
const filas=n=>X.utils.sheet_to_json(wb.Sheets[n],{header:1,defval:''});
const csv=v=>{const s=String(v).replace(/\s+/g,' ').trim();return /[",]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
// Productos y servicios: desde el renglón de encabezados; solo vigentes (sin fecha fin)
let p=filas('c_ClaveProdServ'); let i=p.findIndex(r=>r[0]==='c_ClaveProdServ');
const prod=p.slice(i+1).filter(r=>r[0]!==''&&r[1]&&r[6]==='').map(r=>[String(r[0]).padStart(8,'0'),r[1]]);
fs.writeFileSync(out+'/SAT_c_ClaveProdServ.csv','Clave,Descripcion\n'+prod.map(r=>r.map(csv).join(',')).join('\n')+'\n');
let u=filas('c_ClaveUnidad'); i=u.findIndex(r=>r[0]==='c_ClaveUnidad');
const uni=u.slice(i+1).filter(r=>r[0]!==''&&r[1]&&r[5]==='').map(r=>[String(r[0]),r[1],r[6]]);
fs.writeFileSync(out+'/SAT_c_ClaveUnidad.csv','Clave,Nombre,Simbolo\n'+uni.map(r=>r.map(csv).join(',')).join('\n')+'\n');
console.log('prodserv vigentes',prod.length,'de',p.length-i-1,'| unidades vigentes',uni.length);
