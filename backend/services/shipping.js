import {randomUUID,createHash} from 'node:crypto';
import {fail,cents} from '../validation.js';
export function postalCode(value){
  if(typeof value!=='string'||!/^\d{5}-?\d{3}$/.test(value)||/^0+$/.test(value.replace('-','')))fail(400,'invalid_cep','Informe um CEP válido com oito números.');
  return value.replace('-','');
}
export function addressInput(value){
  const fields=['cep','street','number','complement','district','city','state'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!fields.includes(k)))fail(400,'invalid_address','Confira o endereço de entrega.');
  const out={};
  for(const field of fields){
    const v=value[field]??'';
    if(typeof v!=='string'||v.length>120||/[<>\x00-\x1f\x7f]/.test(v)||(!v.trim()&&field!=='complement'))fail(400,'invalid_address','Preencha os campos obrigatórios do endereço.');
    out[field]=v.trim();
  }
  out.cep=postalCode(out.cep);out.state=out.state.toUpperCase();
  if(!'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(out.state))fail(400,'invalid_state','Selecione um estado válido.');
  return out;
}
export const deliveryHash=(cartHash,address,quote)=>createHash('sha256').update(JSON.stringify([cartHash,address,quote.serviceCode,quote.priceCents])).digest('hex');
export function createShipping(store,provider){
  store.db.exec('CREATE TABLE IF NOT EXISTS shipping_quotes (id TEXT PRIMARY KEY, owner TEXT NOT NULL, document TEXT NOT NULL, expires INTEGER NOT NULL)');
  return {
    configured:provider.configured,
    async quote(owner,cart,cep){
      cep=postalCode(cep);
      if(!provider.configured)fail(503,'shipping_not_configured','A cotação dos Correios ainda não está disponível. Entre em contato com a loja.');
      const options=await provider.quote(cart.items,cep);
      if(!Array.isArray(options)||!options.length)fail(503,'shipping_unavailable','Não há serviço disponível para este CEP.');
      store.db.prepare('DELETE FROM shipping_quotes WHERE expires < ?').run(Date.now());
      return options.map(option=>{
        if(!Number.isSafeInteger(option.priceCents)||option.priceCents<=0||option.priceCents>10000000||!Number.isSafeInteger(option.days)||option.days<1||option.days>365||!(/^[A-Za-z0-9_-]{1,40}$/).test(option.serviceCode)||typeof option.name!=='string')fail(502,'shipping_invalid','Não foi possível confirmar o frete.');
        const q={quoteId:randomUUID(),cartHash:cart.hash,cep,...option,expiresAt:Date.now()+10*60000};
        store.db.prepare('INSERT INTO shipping_quotes VALUES (?,?,?,?)').run(q.quoteId,owner,JSON.stringify(q),q.expiresAt);
        const {cartHash,...publicQuote}=q;return publicQuote;
      });
    },
    get(owner,id,cart,cep,{allowExpired=false}={}){
      const row=typeof id==='string'?store.db.prepare('SELECT * FROM shipping_quotes WHERE id=? AND owner=?').get(id,owner):null;
      if(!row)fail(409,'shipping_quote_required','Calcule e selecione o frete antes de continuar.');
      const q=JSON.parse(row.document);
      if(q.cartHash!==cart.hash||q.cep!==cep||(!allowExpired&&row.expires<Date.now()))fail(409,'shipping_quote_expired','O carrinho ou CEP mudou, ou a cotação expirou. Calcule o frete novamente.');
      return q;
    }
  };
}
// Official Correios REST API; credentials and package measurements stay on the server.
export function createCorreios(env=process.env,fetchImpl=fetch){
  const mode=env.CORREIOS_MODE||'disabled';
  if(!['disabled','homologation','production'].includes(mode))throw Error('CORREIOS_MODE inválido.');
  const origin=env.SHIPPING_ORIGIN_CEP||'',services=[['PAC',env.CORREIOS_PAC_CODE],['SEDEX',env.CORREIOS_SEDEX_CODE]].filter(([,code])=>code);
  const sizes=['SHIPPING_UNIT_WEIGHT_G','SHIPPING_PACKAGE_WEIGHT_G','SHIPPING_LENGTH_CM','SHIPPING_WIDTH_CM','SHIPPING_BASE_HEIGHT_CM','SHIPPING_UNIT_HEIGHT_CM'].map(k=>Number(env[k]));
  const configured=Boolean(mode!=='disabled'&&env.CORREIOS_USER&&env.CORREIOS_API_PASSWORD&&env.CORREIOS_POSTING_CARD&&/^\d{8}$/.test(origin)&&services.length&&services.every(([,c])=>/^\d{5}$/.test(c))&&sizes.every(n=>Number.isFinite(n)&&n>0));
  const host=mode==='production'?'https://api.correios.com.br':'https://apihom.correios.com.br';
  let token='',validUntil=0;
  async function request(path,options){
    try{const r=await fetchImpl(host+path,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();return await r.json();}
    catch{fail(503,'correios_unavailable','Os Correios não confirmaram a cotação. Tente novamente mais tarde.');}
  }
  async function authenticate(){
    if(token&&validUntil>Date.now())return token;
    const data=await request('/token/v1/autentica/cartaopostagem',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(env.CORREIOS_USER+':'+env.CORREIOS_API_PASSWORD).toString('base64')},body:JSON.stringify({numero:env.CORREIOS_POSTING_CARD})});
    if(typeof data.token!=='string'||!data.token)fail(503,'correios_auth','Não foi possível consultar os Correios.');
    token=data.token;validUntil=Date.now()+5*60000;return token;
  }
  return {configured,mode,async quote(items,cep){
    if(!configured)fail(503,'shipping_not_configured','Configuração de frete pendente.');
    const units=items.reduce((n,i)=>n+i.quantity,0),[unitWeight,boxWeight,length,width,baseHeight,unitHeight]=sizes;
    const weight=Math.ceil(boxWeight+units*unitWeight),height=Math.ceil(baseHeight+units*unitHeight);
    if(weight>30000||Math.max(length,width,height)>100||length+width+height>200)fail(409,'package_limit','Esta quantidade exige outra embalagem. Entre em contato para cotar a entrega.');
    const bearer=await authenticate(),headers={Authorization:'Bearer '+bearer,Accept:'application/json'};
    const results=await Promise.allSettled(services.map(async([name,serviceCode])=>{
      const query=new URLSearchParams({cepOrigem:origin,cepDestino:cep,psObjeto:String(weight),tpObjeto:'2',comprimento:String(length),largura:String(width),altura:String(height)});
      const [price,term]=await Promise.all([request('/preco/v1/nacional/'+serviceCode+'?'+query,{headers}),request('/prazo/v1/nacional/'+serviceCode+'?'+new URLSearchParams({cepOrigem:origin,cepDestino:cep}),{headers})]);
      if(price.coProduto!==serviceCode||term.coProduto!==serviceCode||price.txErro||term.txErro||typeof price.pcFinal!=='string')throw Error('invalid quote');
      return {serviceCode,name:'Correios '+name,priceCents:cents(price.pcFinal.replace(',','.')),days:Number(term.prazoEntrega)};
    }));
    const options=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
    if(!options.length)fail(503,'shipping_unavailable','Não foi possível obter frete para este CEP. Confira o CEP e tente novamente.');
    return options;
  }};
}

// SuperFrete API adapter. The access token and package information never leave
// the server; the browser receives only the final delivery options.
export function createSuperfrete(env=process.env,fetchImpl=fetch){
  const token=env.SUPERFRETE_TOKEN||'',origin=env.SHIPPING_ORIGIN_CEP||'';
  const services=(env.SUPERFRETE_SERVICES||'1,2,17').split(',').map(v=>v.trim()).filter(v=>/^\d+$/.test(v));
  const sizes=['SHIPPING_UNIT_WEIGHT_G','SHIPPING_PACKAGE_WEIGHT_G','SHIPPING_LENGTH_CM','SHIPPING_WIDTH_CM','SHIPPING_BASE_HEIGHT_CM','SHIPPING_UNIT_HEIGHT_CM'].map(k=>Number(env[k]));
  const configured=Boolean(token&&/^\d{8}$/.test(origin)&&services.length&&sizes.every(n=>Number.isFinite(n)&&n>0));
  return {configured,async quote(items,cep){
    if(!configured)fail(503,'shipping_not_configured','A configuração do SuperFrete está pendente.');
    const units=items.reduce((n,i)=>n+i.quantity,0),[unitWeight,boxWeight,length,width,baseHeight,unitHeight]=sizes;
    const weightGrams=Math.ceil(boxWeight+units*unitWeight),height=Math.ceil(baseHeight+units*unitHeight);
    if(weightGrams>30000||Math.max(length,width,height)>100||length+width+height>200)fail(409,'package_limit','Esta quantidade exige outra embalagem. Entre em contato para cotar a entrega.');
    let data;
    try{
      const weight=Number((weightGrams/1000).toFixed(3));
      const response=await fetchImpl('https://api.superfrete.com/api/v0/calculator',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({from:{postal_code:origin},to:{postal_code:cep},services:services.join(','),options:{own_hand:false,receipt:false,insurance_value:0},package:{height,width,length,weight}})});
      if(!response.ok)throw Error('superfrete_request');data=await response.json();
    }catch{fail(503,'superfrete_unavailable','O SuperFrete não confirmou a cotação. Tente novamente mais tarde.');}
    if(!Array.isArray(data))fail(502,'shipping_invalid','Não foi possível confirmar o frete.');
    const options=data.map(row=>{
      const value=typeof row?.price==='number'?row.price.toFixed(2):String(row?.price||'').replace(',','.');
      const days=Number(row?.delivery_time),id=String(row?.id??'');
      if(!/^\d+$/.test(id)||!Number.isInteger(days))return null;
      const carrier=typeof row?.company?.name==='string'?row.company.name.trim():'';
      const modality=typeof row?.name==='string'?row.name.trim():'';
      if(!carrier&&!modality)return null;
      return {serviceCode:'SF-'+id,name:'SuperFrete · '+[carrier,modality].filter(Boolean).join(' '),priceCents:cents(value),days};
    }).filter(Boolean);
    if(!options.length)fail(503,'shipping_unavailable','Não há modalidade de entrega disponível para este CEP.');
    return options;
  }};
}

export function createShippingProvider(env=process.env,fetchImpl=fetch){
  const provider=env.SHIPPING_PROVIDER||(env.SUPERFRETE_TOKEN?'superfrete':'correios');
  if(provider==='superfrete')return createSuperfrete(env,fetchImpl);
  if(provider==='correios')return createCorreios(env,fetchImpl);
  throw Error('SHIPPING_PROVIDER inválido.');
}
