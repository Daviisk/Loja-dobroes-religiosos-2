import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
// Single-file visual preview; financial operations require the server.
let html=readFileSync('frontend/index.html','utf8');
html=html.replace(/<link rel="stylesheet" href="([^"<>]+)">/g,(_,path)=>'<style>\n'+readFileSync('frontend/'+path,'utf8')+'\n</style>');
const assets=new Map();
html=html.replace(/src="(images\/[^"<>]+\.(?:png|webp))"/g,(_,path)=>{if(!assets.has(path))assets.set(path,'data:image/'+(path.endsWith('.webp')?'webp':'png')+';base64,'+readFileSync('frontend/'+path).toString('base64'));return 'data-embedded-image="'+path+'"';});
html=html.replace('<script>',()=>'<script>{const images='+JSON.stringify(Object.fromEntries(assets))+';document.querySelectorAll("[data-embedded-image]").forEach(img=>img.src=images[img.dataset.embeddedImage]);}</script>\n<script>');
for(const name of ['cart-model','cart'])html=html.replace(`<script defer src="js/${name}.js"></script>`,()=>'<script>\n'+readFileSync(`frontend/js/${name}.js`,'utf8')+'\n</script>');
const output=resolve(process.argv[2]||'dist/dobroes-visualizacao.html');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,html);console.log(output);
