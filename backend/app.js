import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {readFileSync} from 'node:fs';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {canonicalCart,calculate,uuid,fail,AppError,validCheckoutURL} from './validation.js';
import {checkoutPayload,paymentSnapshot,cardPaymentSnapshot,cardPaymentChallenge} from './services/mercadopago.js';
import {authenticateWebhook} from './services/webhook.js';
import {addressInput,postalCode,deliveryHash,createShipping,createShippingProvider} from './services/shipping.js';

const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const terminalStatus=new Set(['paid','cancelled','refunded','partially_refunded','failed','charged_back']);
function publicOrder(o){return {orderId:o.orderId,providerOrderId:o.providerOrderId||null,items:o.items,productsTotal:o.productsTotal,shipping:o.shipping,address:o.address,total:o.total,currency:o.currency,status:o.status,createdAt:o.createdAt,paymentProvider:o.paymentProvider,paymentId:o.paymentId,providerStatusDetail:o.providerStatusDetail||''};}
function cardInput(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='email,identificationNumber,identificationType,installments,issuerId,paymentMethodId,token')fail(400,'invalid_card_data','Dados do pagamento inválidos.');
  const token=String(raw.token||''),issuerId=String(raw.issuerId||''),paymentMethodId=String(raw.paymentMethodId||''),email=String(raw.email||'').trim(),identificationType=String(raw.identificationType||'').trim(),identificationNumber=String(raw.identificationNumber||'').trim(),installments=Number(raw.installments);
  if(!/^[A-Za-z0-9._-]{20,2048}$/.test(token))fail(400,'invalid_card_token','Token do cartão inválido.');
  if(issuerId&&!/^\d{1,24}$/.test(issuerId))fail(400,'invalid_issuer','Emissor do cartão inválido.');
  if(!/^[a-z0-9_-]{1,64}$/i.test(paymentMethodId))fail(400,'invalid_payment_method','Meio de pagamento inválido.');
  if(!Number.isInteger(installments)||installments<1||installments>24)fail(400,'invalid_installments','Número de parcelas inválido.');
  if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'invalid_email','E-mail do pagador inválido.');
  if(!/^[A-Za-z0-9_-]{1,20}$/.test(identificationType))fail(400,'invalid_identification','Tipo de documento inválido.');
  if(!/^[A-Za-z0-9.\/-]{4,32}$/.test(identificationNumber))fail(400,'invalid_identification','Documento inválido.');
  return {token,issuerId,paymentMethodId,installments,email,identificationType,identificationNumber};
}
function cardCheckoutHash(cart,address,quote){return createHash('sha256').update(deliveryHash(cart.hash,address,quote)+':'+quote.quoteId).digest('hex');}

export function createApp({config,catalog,store,gateway,shipping=createShipping(store,createShippingProvider()),logger=console}){
  const app=express();app.disable('x-powered-by');app.set('trust proxy',config.trustProxy||false);app.set('query parser','simple');
  const html=readFileSync(join(config.frontendPath,'index.html'),'utf8');
  const cartScript=readFileSync(join(config.frontendPath,'js','cart.js'),'utf8');
  const cardPaymentScript=readFileSync(join(config.frontendPath,'js','card-payment.js'),'utf8');
  const hashes=tag=>[...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'g'))].map(m=>`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
  app.use(helmet({contentSecurityPolicy:{directives:{
    defaultSrc:["'self'"],
    scriptSrc:["'self'",'https://sdk.mercadopago.com','https://*.mlstatic.com',...hashes('script')],
    styleSrc:["'self'",...hashes('style')],
    imgSrc:["'self'",'data:','https://*.mercadopago.com','https://*.mercadopago.com.br','https://*.mlstatic.com'],
    fontSrc:["'self'",'data:'],
    connectSrc:["'self'",'https://viacep.com.br','https://api.mercadopago.com','https://*.mercadopago.com','https://*.mercadopago.com.br','https://*.mlstatic.com'],
    frameSrc:['https:'],
    objectSrc:["'none'"],baseUri:["'none'"],frameAncestors:["'none'"],formAction:["'self'",'https:'],upgradeInsecureRequests:config.production?[]:null
  }},referrerPolicy:{policy:'no-referrer'},hsts:config.production?{maxAge:31536000}:false}));
  app.use((req,res,next)=>{res.set('Cache-Control','no-store');if(config.production&&!req.secure)return res.status(400).json({error:'https_required',message:'Use HTTPS.'});if(req.get('origin')&&req.get('origin')!==config.baseURL)return res.status(403).json({error:'origin_forbidden',message:'Origem não permitida.'});next();});
  const limit=(n,windowMs=60000)=>rateLimit({windowMs,limit:n,standardHeaders:'draft-8',legacyHeaders:false,handler:(req,res)=>res.status(429).json({error:'rate_limited',message:'Muitas tentativas. Aguarde um minuto e tente novamente.'})});
  app.use('/api',limit(240));
  app.use(express.json({limit:'8kb',strict:true,type:'application/json'}));
  function session(req,res,next){const raw=(req.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('jewelry_session='))?.slice('jewelry_session='.length);const current=store.session(raw);if(!current)fail(401,'session_required','Abra novamente o carrinho para iniciar sua sessão.');req.shopSession=current;next();}
  function mutation(req,res,next){if(!req.is('application/json'))fail(415,'json_required','Use JSON.');if(req.get('origin')!==config.baseURL)fail(403,'origin_forbidden','Origem não permitida.');if(!equal(req.get('x-csrf-token'),req.shopSession.csrf))fail(403,'csrf_invalid','Atualize a página para continuar.');next();}
  function prepareCardOrder(req,key,{allowExpired=false}={}){
    if(!req.body||Object.keys(req.body).sort().join(',')!=='address,items,quoteId')fail(400,'invalid_checkout','Envie somente items, address e quoteId.');
    if(!gateway.cardConfigured||!config.publicKey||!shipping.configured)fail(503,'gateway_not_configured','O pagamento por cartão ainda não está disponível.');
    const cart=canonicalCart({items:req.body.items},catalog),address=addressInput(req.body.address);
    const quote=shipping.get(req.shopSession.id,req.body.quoteId,cart,address.cep,{allowExpired});
    const checkoutCart={...cart,hash:cardCheckoutHash(cart,address,quote)};
    let order=store.findRequest(req.shopSession.id,key,checkoutCart.hash);
    if(!order){
      const totals=calculate(cart.items,catalog);totals.productsTotal=totals.total;totals.total+=quote.priceCents;
      if(!Number.isSafeInteger(totals.total)||totals.total<=0||totals.total>100000000)fail(400,'total_limit','Valor do pedido inválido.');
      totals.address=address;totals.shipping={name:quote.name,serviceCode:quote.serviceCode,priceCents:quote.priceCents,days:quote.days,cep:quote.cep};totals.quoteExpiresAt=quote.expiresAt;
      order=store.obtain(req.shopSession.id,key,checkoutCart,totals,()=>({integration:'cardform'}));
    }
    if(order.gatewayPayload?.integration!=='cardform')fail(409,'payment_flow_mismatch','Este pedido pertence a outro fluxo de pagamento.');
    if(Date.now()-Date.parse(order.createdAt)>86400000)fail(409,'order_needs_review','Este pedido expirou. Calcule o frete novamente.');
    return {order,quote};
  }

  app.get('/api/session',limit(config.sessionLimit),(req,res)=>{const raw=(req.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('jewelry_session='))?.slice('jewelry_session='.length);let s=store.session(raw);if(!s){s=store.newSession();res.cookie('jewelry_session',s.raw,{httpOnly:true,secure:config.production,sameSite:'lax',path:'/',maxAge:7*86400000});}res.json({csrfToken:s.csrf});});
  app.get('/api/products',(req,res)=>{const cardFormConfigured=Boolean(gateway.cardConfigured&&config.publicKey&&shipping.configured);res.json({currency:'BRL',products:catalog.map(p=>({...p})),shippingConfigured:shipping.configured,checkoutConfigured:cardFormConfigured,cardFormConfigured,paymentMode:'cardform',mercadoPagoPublicKey:cardFormConfigured?config.publicKey:''});});
  app.post('/api/shipping/quote',limit(15),session,mutation,async(req,res)=>{if(!req.body||Object.keys(req.body).sort().join(',')!=='cep,items')fail(400,'invalid_shipping','Envie somente items e cep.');const cart=canonicalCart({items:req.body.items},catalog),cep=postalCode(req.body.cep);res.json({options:await shipping.quote(req.shopSession.id,cart,cep)});});

  // Legacy Checkout Pro route kept only for backwards compatibility; the storefront uses CardForm.
  const inFlight=new Map();
  app.post('/api/checkout',limit(config.checkoutLimit),session,mutation,async(req,res)=>{
    const key=req.get('idempotency-key');if(!uuid(key))fail(400,'idempotency_required','Identificador de tentativa inválido.');if(!req.body||Object.keys(req.body).sort().join(',')!=='address,items,quoteId')fail(400,'invalid_checkout','Envie items, address e quoteId.');
    const cart=canonicalCart({items:req.body.items},catalog),address=addressInput(req.body.address);const quote=shipping.get(req.shopSession.id,req.body.quoteId,cart,address.cep,{allowExpired:true});const checkoutCart={...cart,hash:deliveryHash(cart.hash,address,quote)};let order=store.findRequest(req.shopSession.id,key,checkoutCart.hash);
    if(!order){shipping.get(req.shopSession.id,req.body.quoteId,cart,address.cep);const totals=calculate(cart.items,catalog);totals.productsTotal=totals.total;totals.total+=quote.priceCents;if(!Number.isSafeInteger(totals.total)||totals.total>100000000)fail(400,'total_limit','Valor acima do limite.');totals.address=address;totals.shipping={name:quote.name,serviceCode:quote.serviceCode,priceCents:quote.priceCents,days:quote.days,cep:quote.cep};if(!gateway.configured||!config.webhookSecret||!shipping.configured)fail(503,'gateway_not_configured','O checkout externo não está disponível.');order=store.obtain(req.shopSession.id,key,checkoutCart,totals,o=>checkoutPayload(o,config.baseURL));}
    if(terminalStatus.has(order.status))return res.json({...publicOrder(order),checkoutUrl:null});if(Date.now()-Date.parse(order.createdAt)>86400000)fail(409,'order_needs_review','Este checkout expirou. Entre em contato para conferir o pedido.');
    if(!order.checkoutUrl){let promise=inFlight.get(order.orderId);if(!promise){promise=(async()=>{try{const created=await gateway.create(order);if(!validCheckoutURL(created.checkoutUrl))fail(502,'invalid_checkout_url','URL de pagamento inválida.');const latest=store.get(order.orderId);latest.providerOrderId=created.providerOrderId;latest.checkoutUrl=created.checkoutUrl;latest.checkoutState='ready';latest.lastError=null;store.save(latest);return latest;}catch(e){const latest=store.get(order.orderId);latest.checkoutState='retryable';latest.lastError=e instanceof AppError?e.code:'gateway_error';store.save(latest);throw e;}finally{inFlight.delete(order.orderId);}})();inFlight.set(order.orderId,promise);}order=await promise;}
    res.json({...publicOrder(order),checkoutUrl:order.checkoutUrl});
  });

  app.post('/api/card/prepare',limit(config.checkoutLimit),session,mutation,(req,res)=>{
    const key=req.get('idempotency-key');if(!uuid(key))fail(400,'idempotency_required','Identificador de tentativa inválido.');
    const {order}=prepareCardOrder(req,key);
    if(terminalStatus.has(order.status))fail(409,'order_terminal','Este pedido já possui um status final. Inicie uma nova tentativa.');
    res.json({...publicOrder(order),amount:(order.total/100).toFixed(2),quoteExpiresAt:order.quoteExpiresAt});
  });

  app.post('/api/card/pay',limit(config.checkoutLimit),session,mutation,async(req,res)=>{
    const key=req.get('idempotency-key');if(!uuid(key))fail(400,'idempotency_required','Identificador de tentativa inválido.');
    if(!req.body||Object.keys(req.body).sort().join(',')!=='card,orderId'||!uuid(req.body.orderId))fail(400,'invalid_payment','Envie somente orderId e card.');
    if(!gateway.cardConfigured||!config.publicKey||!shipping.configured)fail(503,'gateway_not_configured','O pagamento por cartão ainda não está disponível.');
    const card=cardInput(req.body.card);let order=store.get(req.body.orderId);
    if(!order||order.owner!==req.shopSession.id)fail(404,'order_not_found','Pedido não encontrado para esta sessão.');
    if(order.gatewayPayload?.integration!=='cardform')fail(409,'payment_flow_mismatch','Este pedido pertence a outro fluxo de pagamento.');
    if(Date.now()-Date.parse(order.createdAt)>86400000)fail(409,'order_needs_review','Este pedido expirou. Calcule o frete novamente.');
    if(order.status==='paid')return res.json({...publicOrder(order),providerStatus:'approved',providerStatusDetail:order.providerStatusDetail||'accredited'});
    if(terminalStatus.has(order.status))return res.json({...publicOrder(order),providerStatus:order.status,providerStatusDetail:order.providerStatusDetail||''});

    let remote;
    if(order.providerOrderId&&/^\d+$/.test(String(order.providerOrderId))){
      remote=await gateway.getPayment(String(order.providerOrderId));
    }else{
      if(Number.isFinite(order.quoteExpiresAt)&&Date.now()>order.quoteExpiresAt)fail(409,'shipping_quote_expired','A cotação de frete expirou. Volte ao carrinho e calcule o frete novamente.');
      if(order.paymentAttemptKey&&order.paymentAttemptKey!==key)fail(409,'payment_in_progress','Já existe uma tentativa de pagamento em andamento para este pedido.');
      if(!order.paymentAttemptKey){order.paymentAttemptKey=key;store.save(order);}
      remote=await gateway.createCardPayment(order,card,key);
    }
    const snapshot=cardPaymentSnapshot(remote,order,gateway);store.applySnapshot(order.orderId,snapshot);order=store.get(order.orderId);
    const challenge=cardPaymentChallenge(remote);
    res.json({...publicOrder(order),providerStatus:String(remote.status||''),providerStatusDetail:String(remote.status_detail||''),threeDs:challenge});
  });

  app.get('/api/orders/:orderId',limit(30),session,async(req,res)=>{
    if(!uuid(req.params.orderId))fail(404,'order_not_found','Pedido não encontrado.');let order=store.get(req.params.orderId);if(!order||order.owner!==req.shopSession.id)fail(404,'order_not_found','Pedido não encontrado para esta sessão.');
    if(['pending','processing','in_mediation'].includes(order.status)&&order.providerOrderId){
      try{
        const isCardPayment=/^\d+$/.test(String(order.providerOrderId));
        const remote=isCardPayment?await gateway.getPayment(String(order.providerOrderId)):await gateway.get(order.providerOrderId);
        const snapshot=isCardPayment?cardPaymentSnapshot(remote,order,gateway):paymentSnapshot(remote,order,gateway);
        store.applySnapshot(order.orderId,snapshot);order=store.get(order.orderId);
      }catch(error){logger.error(JSON.stringify({event:'order_reconciliation_failed',orderId:order.orderId,providerOrderId:order.providerOrderId,code:error instanceof AppError?error.code:'gateway_error'}));}
    }
    res.json(publicOrder(order));
  });

  app.post('/api/webhooks/mercadopago',limit(config.webhookLimit),async(req,res)=>{
    if(!req.is('application/json'))fail(415,'json_required','Use JSON.');
    const notification=authenticateWebhook(req,config.webhookSecret);
    const remote=notification.type==='payment'?await gateway.getPayment(notification.id):await gateway.get(notification.id);
    if(!uuid(remote.external_reference))fail(409,'unknown_order','Pedido não reconhecido.');
    const order=store.get(remote.external_reference);if(!order)fail(409,'unknown_order','Pedido não reconhecido.');
    if(notification.type==='payment'&&order.providerOrderId&&String(order.providerOrderId)!==String(remote.id))fail(409,'provider_id_mismatch','Pagamento não associado a este pedido.');
    if(notification.type==='order'&&!order.providerOrderId)fail(503,'order_being_created','Pedido sendo registrado. Reenvie a notificação.');
    const snapshot=notification.type==='payment'?cardPaymentSnapshot(remote,order,gateway):paymentSnapshot(remote,order,gateway);
    store.applySnapshot(order.orderId,snapshot);res.status(200).json({received:true});
  });

  app.get('/js/cart.js',(req,res)=>{res.type('application/javascript').send(cartScript+'\n'+cardPaymentScript);});
  app.get(['/sucesso','/sucesso.html'],(req,res)=>res.sendFile(join(config.frontendPath,'sucesso.html')));
  app.use(express.static(config.frontendPath,{dotfiles:'deny',index:'index.html',redirect:false,etag:false}));
  app.use((req,res)=>res.status(404).json({error:'not_found',message:'Recurso não encontrado.'}));
  app.use((error,req,res,next)=>{if(res.headersSent)return next(error);if(error.type==='entity.parse.failed')return res.status(400).json({error:'invalid_json',message:'JSON malformado.'});if(error.type==='entity.too.large')return res.status(413).json({error:'body_too_large',message:'Requisição muito grande.'});if(error instanceof AppError)return res.status(error.status).json({error:error.code,message:error.message});const incident=randomUUID();logger.error(JSON.stringify({event:'internal_error',incident}));res.status(500).json({error:'internal_error',message:'Não foi possível concluir a operação.',incident});});
  return app;
}
