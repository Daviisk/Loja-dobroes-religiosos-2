import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {fail,uuid} from './validation.js';

const fulfillmentStatuses=new Set(['awaiting_payment','paid','preparing','shipped','delivered','hold','cancelled']);
const fulfillableStatuses=new Set(['preparing','shipped','delivered']);
const incidentStatuses=new Set(['in_mediation','partially_refunded','refunded','charged_back','failed','cancelled']);
const cookieName='jewelry_admin';
const hash=value=>createHash('sha256').update(String(value)).digest();
const equal=(a,b)=>{const aa=hash(a),bb=hash(b);return timingSafeEqual(aa,bb);};
const cookies=req=>Object.fromEntries((req.get('cookie')||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return i<0?[v,'']:[v.slice(0,i),v.slice(i+1)];}));

function sign(config,expires,nonce){return createHmac('sha256',config.adminSessionSecret).update(`${expires}.${nonce}`).digest('hex');}
function issue(config){const expires=Date.now()+8*60*60*1000,nonce=randomBytes(18).toString('hex');return `${expires}.${nonce}.${sign(config,expires,nonce)}`;}
function validSession(req,config){
  if(!config.adminConfigured)return false;
  const token=cookies(req)[cookieName]||'',parts=token.split('.');if(parts.length!==3)return false;
  const [expires,nonce,signature]=parts;if(!/^\d{13}$/.test(expires)||!/^[a-f0-9]{36}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(signature)||Number(expires)<Date.now())return false;
  return equal(signature,sign(config,expires,nonce));
}
function publicAdminOrder(order){
  return {orderId:order.orderId,orderCode:order.orderCode||String(order.orderId).slice(0,8).toUpperCase(),createdAt:order.createdAt,customer:order.customer||null,items:order.items||[],productsTotal:order.productsTotal,total:order.total,currency:order.currency||'BRL',shipping:order.shipping||null,address:order.address||null,status:order.status,paymentProvider:order.paymentProvider||'mercadopago',paymentId:order.paymentId||order.providerOrderId||null,providerStatusDetail:order.providerStatusDetail||'',providerUpdatedAt:order.providerUpdatedAt||null,fulfillmentStatus:order.fulfillmentStatus||'awaiting_payment',fulfillmentHistory:Array.isArray(order.fulfillmentHistory)?order.fulfillmentHistory:[],trackingCode:order.trackingCode||'',adminNotes:order.adminNotes||'',fulfillmentUpdatedAt:order.fulfillmentUpdatedAt||null};
}

export function mountAdmin(app,{config,store,limit,catalog=[],notifier=null}){
  const loginLimit=limit(8,15*60*1000);
  const requireAdmin=(req,res,next)=>{if(!validSession(req,config))return res.status(401).json({error:'admin_required',message:'Faça login para acessar o painel.'});next();};
  const adminMutation=(req,res,next)=>{if(req.get('origin')!==config.baseURL)fail(403,'origin_forbidden','Origem não permitida.');next();};
  const flush=async orderId=>{try{await notifier?.flush?.(orderId);}catch{}}

  app.get('/api/admin/session',(req,res)=>res.json({configured:config.adminConfigured,authenticated:validSession(req,config),emailNotificationsConfigured:Boolean(notifier?.configured),analyticsEnabled:Boolean(config.analyticsEnabled),inventoryEnforcement:Boolean(config.inventoryEnforcement)}));
  app.post('/api/admin/login',loginLimit,(req,res)=>{
    if(!config.adminConfigured)fail(503,'admin_not_configured','Configure o acesso administrativo no servidor.');
    if(!req.is('application/json')||!req.body||Object.keys(req.body).join(',')!=='password'||typeof req.body.password!=='string')fail(400,'invalid_login','Login inválido.');
    if(!equal(req.body.password,config.adminPassword))fail(401,'invalid_login','Senha inválida.');
    res.cookie(cookieName,issue(config),{httpOnly:true,secure:config.production,sameSite:'strict',path:'/',maxAge:8*60*60*1000});res.json({authenticated:true});
  });
  app.post('/api/admin/logout',requireAdmin,adminMutation,(req,res)=>{res.clearCookie(cookieName,{httpOnly:true,secure:config.production,sameSite:'strict',path:'/'});res.json({authenticated:false});});

  app.get('/api/admin/orders',requireAdmin,async(req,res)=>{
    const limitValue=Math.min(500,Math.max(1,Number(req.query.limit)||200));
    const orders=(await store.listOrders({q:String(req.query.q||''),status:String(req.query.status||''),fulfillment:String(req.query.fulfillment||''),from:String(req.query.from||''),to:String(req.query.to||''),limit:limitValue})).map(publicAdminOrder);
    const paidOrders=orders.filter(o=>o.status==='paid');
    const revenuePaid=paidOrders.reduce((sum,o)=>sum+(Number.isSafeInteger(o.total)&&o.total>=0?o.total:0),0);
    const summary={
      total:orders.length,
      paid:paidOrders.length,
      open:orders.filter(o=>!['refunded','charged_back','cancelled','failed'].includes(o.status)&&!['delivered','cancelled'].includes(o.fulfillmentStatus)).length,
      awaitingPayment:orders.filter(o=>['pending','processing'].includes(o.status)).length,
      awaitingShipment:orders.filter(o=>o.status==='paid'&&['paid','preparing'].includes(o.fulfillmentStatus)).length,
      preparing:orders.filter(o=>o.fulfillmentStatus==='preparing').length,
      shipped:orders.filter(o=>o.fulfillmentStatus==='shipped').length,
      revenuePaid,
      ticketAverage:paidOrders.length?Math.round(revenuePaid/paidOrders.length):0
    };
    res.json({orders,summary});
  });
  app.get('/api/admin/orders/:orderId',requireAdmin,async(req,res)=>{if(!uuid(req.params.orderId))fail(404,'order_not_found','Pedido não encontrado.');const order=await store.get(req.params.orderId);if(!order)fail(404,'order_not_found','Pedido não encontrado.');res.json(publicAdminOrder(order));});
  app.patch('/api/admin/orders/:orderId',requireAdmin,adminMutation,async(req,res)=>{
    if(!uuid(req.params.orderId))fail(404,'order_not_found','Pedido não encontrado.');
    if(!req.is('application/json')||!req.body||Object.keys(req.body).some(key=>!['fulfillmentStatus','trackingCode','adminNotes'].includes(key)))fail(400,'invalid_admin_update','Atualização inválida.');
    const fulfillmentStatus=String(req.body.fulfillmentStatus||''),trackingCode=String(req.body.trackingCode||'').trim(),adminNotes=String(req.body.adminNotes||'').trim();
    if(!fulfillmentStatuses.has(fulfillmentStatus)||trackingCode.length>100||adminNotes.length>1000||/[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(trackingCode+adminNotes))fail(400,'invalid_admin_update','Confira os dados de acompanhamento.');
    const current=await store.get(req.params.orderId);if(!current)fail(404,'order_not_found','Pedido não encontrado.');
    if(fulfillableStatuses.has(fulfillmentStatus)&&current.status!=='paid')fail(409,'payment_not_confirmed','Só é possível preparar ou enviar pedidos com pagamento confirmado.');
    const before={fulfillmentStatus:current.fulfillmentStatus||'awaiting_payment',trackingCode:current.trackingCode||'',adminNotes:current.adminNotes||''};
    const order=await store.updateFulfillment(req.params.orderId,{fulfillmentStatus,trackingCode,adminNotes});
    await store.appendAudit?.({orderId:order.orderId,customerId:order.customer?.customerId||null,actor:'admin',action:'order.fulfillment_updated',detail:{before,after:{fulfillmentStatus:order.fulfillmentStatus,trackingCode:order.trackingCode||'',adminNotes:order.adminNotes||''}}});
    await flush(order.orderId);res.json(publicAdminOrder(order));
  });

  app.get('/api/admin/customers',requireAdmin,async(req,res)=>res.json({customers:await store.listCustomers({q:String(req.query.q||''),limit:Math.min(500,Math.max(1,Number(req.query.limit)||200))})}));
  app.get('/api/admin/customers/:customerId',requireAdmin,async(req,res)=>{if(!uuid(req.params.customerId))fail(404,'customer_not_found','Cliente não encontrado.');const detail=await store.getCustomerDetail?.(req.params.customerId);if(!detail)fail(404,'customer_not_found','Cliente não encontrado.');res.json({customer:detail.customer,orders:(detail.orders||[]).map(publicAdminOrder),addresses:detail.addresses||[]});});

  app.get('/api/admin/incidents',requireAdmin,async(req,res)=>{const orders=(await store.listOrders({limit:500})).filter(order=>incidentStatuses.has(order.status)||order.fulfillmentStatus==='hold').map(publicAdminOrder);res.json({orders});});
  app.get('/api/admin/audit',requireAdmin,async(req,res)=>res.json({entries:await store.listAudit?.({limit:Math.min(500,Math.max(1,Number(req.query.limit)||250))})||[]}));

  app.get('/api/admin/inventory',requireAdmin,async(req,res)=>res.json({items:await store.listInventory?.(catalog)||[],enforcementEnabled:Boolean(config.inventoryEnforcement)}));
  app.patch('/api/admin/inventory/:productId',requireAdmin,adminMutation,async(req,res)=>{
    const product=catalog.find(p=>p.productId===req.params.productId);if(!product)fail(404,'product_not_found','Produto não encontrado.');
    if(!req.is('application/json')||!req.body||Object.keys(req.body).sort().join(',')!=='enabled,minimumQuantity,quantity')fail(400,'invalid_inventory','Atualização de estoque inválida.');
    const quantity=req.body.quantity===null?null:Number(req.body.quantity),minimumQuantity=Number(req.body.minimumQuantity),enabled=req.body.enabled;
    if((quantity!==null&&(!Number.isInteger(quantity)||quantity<0||quantity>1000000))||!Number.isInteger(minimumQuantity)||minimumQuantity<0||minimumQuantity>1000000||typeof enabled!=='boolean')fail(400,'invalid_inventory','Confira quantidade e estoque mínimo.');
    const item=await store.updateInventory(req.params.productId,{quantity,minimumQuantity,enabled});await store.appendAudit?.({actor:'admin',action:'inventory.updated',detail:{productId:req.params.productId,quantity,minimumQuantity,enabled}});res.json({...item,name:product.name,enforcementEnabled:Boolean(config.inventoryEnforcement)});
  });

  app.get('/api/admin/analytics',requireAdmin,async(req,res)=>res.json({enabled:Boolean(config.analyticsEnabled),summary:await store.analyticsSummary?.({days:Math.min(365,Math.max(1,Number(req.query.days)||30))})||{days:30,events:{},total:0}}));
  app.get('/api/admin/export',requireAdmin,async(req,res)=>{const [orders,customers,audit,inventory]=await Promise.all([store.listOrders({limit:5000}),store.listCustomers({limit:1500}),store.listAudit?.({limit:500})||[],store.listInventory?.(catalog)||[]]);res.set('Content-Disposition',`attachment; filename="dobroes-backup-${new Date().toISOString().slice(0,10)}.json"`);res.json({schemaVersion:1,generatedAt:new Date().toISOString(),orders:orders.map(publicAdminOrder),customers,audit,inventory});});
  app.post('/api/admin/notifications/:orderId/retry',requireAdmin,adminMutation,async(req,res)=>{if(!uuid(req.params.orderId))fail(404,'order_not_found','Pedido não encontrado.');const order=await store.get(req.params.orderId);if(!order)fail(404,'order_not_found','Pedido não encontrado.');const result=await notifier?.flush?.(order.orderId)||{configured:false,processed:0};res.json(result);});
}
