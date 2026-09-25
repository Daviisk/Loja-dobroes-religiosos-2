import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
function htmlFiles(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?htmlFiles(join(dir,e.name)):e.name.endsWith('.html')?[join(dir,e.name)]:[]);}
const hashes=new Set();
for(const file of [join(root,'index.html'),...htmlFiles(join(root,'frontend'))]){
 const html=readFileSync(file,'utf8');
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc\s*=/i.test(match[1])||!match[2].trim())continue;
  hashes.add("'sha256-"+createHash('sha256').update(match[2]).digest('base64')+"'");
 }
}
const policy=[
 "default-src 'self'",
 "script-src 'self' https://sdk.mercadopago.com https://*.mlstatic.com "+[...hashes].sort().join(' '),
 "script-src-attr 'none'",
 // Existing inline layout styles and provider-generated styles require this.
 "style-src 'self' 'unsafe-inline'",
 "img-src 'self' data: https://*.mercadopago.com https://*.mercadopago.com.br https://*.mlstatic.com",
 "font-src 'self' data:",
 "connect-src 'self' https://viacep.com.br https://api.mercadopago.com https://*.mercadopago.com https://*.mercadopago.com.br https://*.mlstatic.com",
 // Bank-issued 3DS challenges can use independent HTTPS domains.
 "frame-src https:",
 "form-action 'self' https:",
 "object-src 'none'","base-uri 'none'","frame-ancestors 'none'",
 "upgrade-insecure-requests"
].join('; ');
const path=join(root,'vercel.json'),config=JSON.parse(readFileSync(path,'utf8'));
const headers=config.routes.find(r=>r.src==='/(.*)'&&r.continue&&r.headers)?.headers;
if(!headers)throw Error('Missing edge security header route');
if(process.argv.includes('--check')){
 if(headers['Content-Security-Policy']!==policy)throw Error('CSP hashes are stale. Run npm run security:headers and commit vercel.json.');
 console.log('CSP matches all inline scripts; no unsafe-inline or unsafe-eval for scripts.');
}else{
 headers['Content-Security-Policy']=policy;
 writeFileSync(path,JSON.stringify(config,null,2)+'\n');
 console.log('Updated CSP using '+hashes.size+' inline script hashes.');
}
