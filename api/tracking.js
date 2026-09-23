import {createHmac,timingSafeEqual} from 'node:crypto';
import {readConfig} from '../backend/config.js';
import {createPostgresStore} from '../backend/postgres-store.js';
import {createGateway,cardPaymentSnapshot} from '../backend/services/mercadopago.js';

const config=readConfig(process.env);
const store=config.databaseUrl?createPostgresStore(config.databaseUrl):null;
const gateway=createGateway({...config,accessToken:config.mode==='disabled'?'':config.accessToken});
const trackingSecret=String(config.adminSessionSecret?.length>=32?config.adminSessionSecret:config.webhookSecret||'');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenPattern=/^[a-f0-9]{64}$/;

function cookie(req,name){
  const raw=String(req.headers.cookie||'');
  for(const part of raw.split(';')){
    const value=part.trim();
    if(value.startsWith(name+'='))return value.slice(name.length+1);
  }
  return '';
}
function trackingToken(orderId){return createHmac('sha256',trackingSecret).update('order-tracking:'+orderId).digest('hex');}
function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;return timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function paymentStarted(order){return Boolean(order&&(
  order.status!=='pending'||order.paymentAttemptKey||order.providerOrderId||order.paymentId
));}
function trackingUrl(order){return `${config.baseURL}/sucesso?orderId=${encodeURIComponent(order.orderId)}&token=${trackingToken(order.orderId)}`;}
function publicTrackingOrder(order){
  return {
    orderId:order.orderId,
    orderCode:order.orderCode||String(order.orderId).slice(0,8).toUpperCase(),
    items:order.items||[],
    productsTotal:order.productsTotal,
    shipping:order.shipping||null,
    address:order.address||null,
    customer:order.customer?{name:order.customer.name}:null,
    total:order.total,
    currency:order.currency||'BRL',
    status:order.status,
    fulfillmentStatus:order.fulfillmentStatus||'awaiting_payment',
    trackingCode:order.trackingCode||'',
    createdAt:order.createdAt,
    paymentMethod:order.paymentMethod||'',
    providerStatusDetail:order.providerStatusDetail||'',
    fulfillmentUpdatedAt:order.fulfillmentUpdatedAt||null,
    trackingUrl:trackingUrl(order)
  };
}
async function refreshPayment(order){
  if(!order||!['pending','processing','paid','partially_refunded','in_mediation'].includes(order.status)||!/^\d+$/.test(String(order.providerOrderId||''))||config.mode==='disabled')return order;
  try{
    const remote=await gateway.getPayment(String(order.providerOrderId));
    await store.applySnapshot(order.orderId,cardPaymentSnapshot(remote,order,gateway));
    return await store.get(order.orderId)||order;
  }catch{return order;}
}
function json(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.end(JSON.stringify(body));}

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return json(res,405,{error:'method_not_allowed',message:'Método não permitido.'});
  if(!store)return json(res,503,{error:'persistent_storage_required',message:'O acompanhamento está temporariamente indisponível.'});
  if(trackingSecret.length<16)return json(res,503,{error:'tracking_not_configured',message:'O acompanhamento seguro ainda não está configurado.'});
  const url=new URL(req.url,'https://tracking.local');
  const action=String(url.searchParams.get('action')||'');
  const orderId=String(url.searchParams.get('orderId')||'');
  if(!uuid.test(orderId))return json(res,404,{error:'order_not_found',message:'Pedido não encontrado.'});

  if(action==='link'){
    const session=await store.session(cookie(req,'jewelry_session'));
    if(!session)return json(res,401,{error:'session_required',message:'Abra novamente a loja no navegador usado na compra.'});
    const order=await store.get(orderId);
    if(!order||order.owner!==session.id)return json(res,404,{error:'order_not_found',message:'Pedido não encontrado para esta sessão.'});
    if(!paymentStarted(order))return json(res,409,{error:'payment_not_started',message:'O link de acompanhamento será liberado quando o pagamento for iniciado.'});
    return json(res,200,{orderId:order.orderId,orderCode:order.orderCode,trackingUrl:trackingUrl(order)});
  }

  if(action==='cancel'){
    const token=String(url.searchParams.get('token')||'').toLowerCase();
    if(!tokenPattern.test(token)||!safeEqual(token,trackingToken(orderId)))return json(res,404,{error:'order_not_found',message:'Link de acompanhamento inválido.'});
    const order=await store.get(orderId);
    if(!order||!paymentStarted(order))return json(res,404,{error:'order_not_found',message:'Pedido não encontrado.'});
    if(order.status==='paid'||['preparing','shipped','delivered'].includes(order.fulfillmentStatus))return json(res,409,{error:'cancel_not_allowed',message:'Este pedido já foi pago ou entrou em preparação. Entre em contato com a loja para solicitar cancelamento ou reembolso.'});
    if(order.fulfillmentStatus==='cancelled'||['cancelled','failed','refunded','charged_back'].includes(order.status))return json(res,200,publicTrackingOrder(order));
    const updated=await store.updateFulfillment(orderId,{fulfillmentStatus:'cancelled',trackingCode:order.trackingCode||'',adminNotes:order.adminNotes||''});
    return json(res,200,publicTrackingOrder(updated||order));
  }

  if(action==='track'){
    const token=String(url.searchParams.get('token')||'').toLowerCase();
    if(!tokenPattern.test(token))return json(res,404,{error:'order_not_found',message:'Link de acompanhamento inválido.'});
    const expected=trackingToken(orderId);
    if(!safeEqual(token,expected))return json(res,404,{error:'order_not_found',message:'Link de acompanhamento inválido.'});
    let order=await store.get(orderId);
    if(!order||!paymentStarted(order))return json(res,404,{error:'order_not_found',message:'Pedido não encontrado.'});
    order=await refreshPayment(order);
    return json(res,200,publicTrackingOrder(order));
  }

  return json(res,404,{error:'not_found',message:'Recurso não encontrado.'});
}
