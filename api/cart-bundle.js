import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const files=['frontend/js/cart.js','frontend/js/card-payment.js','frontend/js/pix-payment.js','frontend/js/tracking-link-injector.js'];
const bundle=files.map(file=>readFileSync(resolve(file),'utf8')).join('\n');

export default function handler(req,res){
  if(req.method!=='GET'){res.statusCode=405;res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify({error:'method_not_allowed',message:'Método não permitido.'}));}
  res.statusCode=200;
  res.setHeader('Content-Type','application/javascript; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(bundle);
}
