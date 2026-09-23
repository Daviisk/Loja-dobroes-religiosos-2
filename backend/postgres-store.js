import postgres from 'postgres';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {fail} from './validation.js';

export const hash=value=>createHash('sha256').update(value).digest('hex');
const terminal=new Set(['paid','cancelled','refunded','partially_refunded','failed','charged_back']);
const decode=value=>{
  if(value===null||value===undefined)return null;
  if(typeof value==='string')return JSON.parse(value);
  return value;
};
const iso=value=>value instanceof Date?value.toISOString():new Date(value).toISOString();

export function createPostgresStore(databaseUrl){
  if(typeof databaseUrl!=='string'||!databaseUrl)throw Error('DATABASE_URL ausente.');
  const sql=postgres(databaseUrl,{prepare:false,max:2,idle_timeout:20,connect_timeout:10,ssl:'require'});

  async function getWith(db,id,{lock=false}={}){
    const rows=lock
      ? await db`SELECT document FROM public.orders WHERE id=${id}::uuid FOR UPDATE`
      : await db`SELECT document FROM public.orders WHERE id=${id}::uuid`;
    return rows[0]?decode(rows[0].document):null;
  }
  async function saveWith(db,order){
    const activeKey=terminal.has(order.status)?null:order.owner+':'+order.cartHash;
    const customerId=order.customer?.customerId||null;
    await db`UPDATE public.orders SET provider_id=${order.providerOrderId||null},active_key=${activeKey},customer_id=${customerId}::uuid,document=${JSON.stringify(order)}::jsonb,updated_at=now() WHERE id=${order.orderId}::uuid`;
  }
  async function findRequestWith(db,owner,key,cartHash){
    const rows=await db`SELECT cart_hash,order_id FROM public.requests WHERE owner=${owner} AND key=${key}::uuid`;
    if(!rows[0])return null;
    if(rows[0].cart_hash!==cartHash)fail(409,'idempotency_conflict','Esta tentativa já foi usada com outro carrinho.');
    return getWith(db,rows[0].order_id);
  }
  async function orderList(limit=1000){
    const n=Math.max(1,Math.min(5000,Number(limit)||1000));
    const rows=await sql`SELECT document FROM public.orders ORDER BY created_at DESC LIMIT ${n}`;
    return rows.map(row=>decode(row.document)).filter(Boolean);
  }
  function addFulfillmentHistory(order,from,to,source){if(from===to)return;const at=new Date().toISOString();order.fulfillmentHistory=Array.isArray(order.fulfillmentHistory)?order.fulfillmentHistory:[];order.fulfillmentHistory.push({from:from??null,to,at,source});order.fulfillmentUpdatedAt=at;}
  async function enqueueWith(db,orderId,kind){await db`INSERT INTO public.outbox (id,order_id,kind,state,created_at) VALUES (${randomUUID()}::uuid,${orderId}::uuid,${kind},'pending',now()) ON CONFLICT (order_id,kind) DO NOTHING`;}
  async function restoreReservationWith(db,row){
    if(!row||row.state!=='reserved')return false;const document=decode(row.document)||{};
    for(const item of document.items||[])await db`UPDATE public.inventory SET quantity=COALESCE(quantity,0)+${Number(item.quantity||0)},updated_at=now() WHERE product_id=${String(item.productId)}`;
    await db`UPDATE public.inventory_reservations SET state='released',updated_at=now() WHERE order_id=${row.order_id}::uuid AND state='reserved'`;return true;
  }
  async function releaseExpiredWith(db){const rows=await db`SELECT order_id,document,state FROM public.inventory_reservations WHERE state='reserved' AND expires_at<=now() FOR UPDATE`;for(const row of rows)await restoreReservationWith(db,row);}
  async function consumeReservationWith(db,orderId){await db`UPDATE public.inventory_reservations SET state='consumed',updated_at=now() WHERE order_id=${orderId}::uuid AND state='reserved'`;}
  async function releaseReservationWith(db,orderId){const rows=await db`SELECT order_id,document,state FROM public.inventory_reservations WHERE order_id=${orderId}::uuid FOR UPDATE`;return rows[0]?restoreReservationWith(db,rows[0]):false;}

  return {
    kind:'postgres',
    sql,
    async ping(){const rows=await sql`SELECT 1 AS ok`;return rows[0]?.ok===1;},
    async close(){await sql.end({timeout:5});},
    async get(id){return getWith(sql,id);},
    async save(order){await saveWith(sql,order);},
    async session(raw){
      if(!/^[a-f0-9]{64}$/.test(raw||''))return null;
      const rows=await sql`SELECT id,csrf,expires_at FROM public.sessions WHERE id=${hash(raw)} AND expires_at>now()`;
      if(!rows[0])return null;
      return {id:rows[0].id,csrf:rows[0].csrf,expires:new Date(rows[0].expires_at).getTime()};
    },
    async newSession(){
      const raw=randomBytes(32).toString('hex'),session={id:hash(raw),csrf:randomBytes(32).toString('hex'),expires:Date.now()+7*86400000};
      await sql.begin(async tx=>{
        await tx`DELETE FROM public.sessions WHERE expires_at<now()`;
        await tx`INSERT INTO public.sessions (id,csrf,expires_at) VALUES (${session.id},${session.csrf},${new Date(session.expires)})`;
      });
      return {...session,raw};
    },
    async upsertCustomer(input){
      const email=String(input.email||'').trim().toLowerCase(),phone=String(input.phone||'').replace(/\D/g,''),name=String(input.name||'').trim();
      return sql.begin(async tx=>{
        let rows=await tx`SELECT id,name,email,phone,created_at,updated_at FROM public.customers WHERE email=${email} LIMIT 1 FOR UPDATE`;
        if(!rows[0]&&phone)rows=await tx`SELECT id,name,email,phone,created_at,updated_at FROM public.customers WHERE phone=${phone} ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`;
        if(rows[0]){
          const row=rows[0];
          const updated=await tx`UPDATE public.customers SET name=${name},email=${email},phone=${phone},updated_at=now() WHERE id=${row.id}::uuid RETURNING id,name,email,phone,created_at,updated_at`;
          const c=updated[0];return {customerId:String(c.id),name:c.name,email:c.email,phone:c.phone,createdAt:iso(c.created_at),updatedAt:iso(c.updated_at)};
        }
        const customerId=randomUUID();
        const inserted=await tx`INSERT INTO public.customers (id,name,email,phone) VALUES (${customerId}::uuid,${name},${email},${phone}) ON CONFLICT (email) DO UPDATE SET name=excluded.name,phone=excluded.phone,updated_at=now() RETURNING id,name,email,phone,created_at,updated_at`;
        const c=inserted[0];return {customerId:String(c.id),name:c.name,email:c.email,phone:c.phone,createdAt:iso(c.created_at),updatedAt:iso(c.updated_at)};
      });
    },
    async findRequest(owner,key,cartHash){return findRequestWith(sql,owner,key,cartHash);},
    async obtain(owner,key,cart,totals,payloadFactory){
      return sql.begin(async tx=>{
        let order=await findRequestWith(tx,owner,key,cart.hash);if(order)return order;
        const activeKey=owner+':'+cart.hash;
        let rows=await tx`SELECT document FROM public.orders WHERE active_key=${activeKey} LIMIT 1 FOR UPDATE`;
        order=rows[0]?decode(rows[0].document):null;
        if(order&&Date.now()-Date.parse(order.createdAt)>86400000)fail(409,'order_needs_review','Há um pedido antigo aguardando conferência. Entre em contato com a loja.');
        if(!order){
          const orderId=randomUUID(),createdAt=new Date().toISOString();
          const seqRows=await tx`SELECT nextval('public.order_number_seq') AS value`,orderCode=String(seqRows[0].value);
          order={orderId,orderCode,owner,cartHash:cart.hash,...totals,status:'pending',fulfillmentStatus:'awaiting_payment',fulfillmentHistory:[{from:null,to:'awaiting_payment',at:createdAt,source:'system'}],trackingCode:'',adminNotes:'',fulfillmentUpdatedAt:createdAt,createdAt,paymentProvider:'mercadopago',paymentId:null,providerOrderId:null,checkoutUrl:null,providerUpdatedAt:null,checkoutState:'creating',lastError:null,paymentAttemptKey:null};
          order.gatewayPayload=payloadFactory(order);
          const customerId=order.customer?.customerId||null;
          rows=await tx`INSERT INTO public.orders (id,owner,cart_hash,active_key,provider_id,customer_id,document,created_at,updated_at) VALUES (${orderId}::uuid,${owner},${cart.hash},${activeKey},NULL,${customerId}::uuid,${JSON.stringify(order)}::jsonb,${new Date(createdAt)},${new Date(createdAt)}) ON CONFLICT (active_key) DO NOTHING RETURNING document`;
          if(!rows[0]){const existing=await tx`SELECT document FROM public.orders WHERE active_key=${activeKey} LIMIT 1 FOR UPDATE`;order=existing[0]?decode(existing[0].document):null;}
          else{order=decode(rows[0].document);await enqueueWith(tx,order.orderId,'order.created');}
          if(!order)throw Error('Não foi possível criar o pedido.');
        }
        const inserted=await tx`INSERT INTO public.requests (owner,key,cart_hash,order_id) VALUES (${owner},${key}::uuid,${cart.hash},${order.orderId}::uuid) ON CONFLICT (owner,key) DO NOTHING RETURNING order_id`;
        if(!inserted[0]){
          const existing=await findRequestWith(tx,owner,key,cart.hash);
          if(existing)return existing;
          throw Error('Não foi possível registrar a tentativa.');
        }
        return order;
      });
    },
    async reserveInventory(orderId,items,expiresAt){return sql.begin(async tx=>{
      await releaseExpiredWith(tx);const existing=await tx`SELECT order_id,document,state FROM public.inventory_reservations WHERE order_id=${orderId}::uuid FOR UPDATE`;if(existing[0]){if(['reserved','consumed'].includes(existing[0].state))return {state:existing[0].state,orderId};fail(409,'stock_reservation_expired','A reserva de estoque deste pedido expirou. Inicie uma nova compra.');}
      const clean=(items||[]).map(item=>({productId:String(item.productId),quantity:Number(item.quantity)}));
      for(const item of clean){const rows=await tx`SELECT product_id,quantity,enabled FROM public.inventory WHERE product_id=${item.productId} FOR UPDATE`,row=rows[0];if(!row||!row.enabled||row.quantity===null||row.quantity===undefined)fail(503,'stock_not_configured','O estoque deste produto ainda não foi configurado para venda.');if(!Number.isInteger(item.quantity)||item.quantity<1||Number(row.quantity)<item.quantity)fail(409,'out_of_stock','A quantidade solicitada não está mais disponível em estoque.');}
      for(const item of clean)await tx`UPDATE public.inventory SET quantity=quantity-${item.quantity},updated_at=now() WHERE product_id=${item.productId}`;
      await tx`INSERT INTO public.inventory_reservations (order_id,document,expires_at,state,created_at,updated_at) VALUES (${orderId}::uuid,${JSON.stringify({items:clean})}::jsonb,${new Date(expiresAt)},'reserved',now(),now())`;return {state:'reserved',orderId};
    });},
    async releaseInventory(orderId){return sql.begin(tx=>releaseReservationWith(tx,orderId));},
    async consumeInventory(orderId){return sql.begin(async tx=>{await consumeReservationWith(tx,orderId);return true;});},
    async applySnapshot(id,snapshot){
      return sql.begin(async tx=>{
        const order=await getWith(tx,id,{lock:true});if(!order)return false;
        const fingerprint=hash(JSON.stringify([snapshot.providerOrderId,snapshot.updatedAt,snapshot.status,snapshot.detail]));
        const seen=await tx`SELECT 1 FROM public.events WHERE fingerprint=${fingerprint}`;if(seen[0])return false;
        if(order.providerUpdatedAt&&Date.parse(snapshot.updatedAt)<Date.parse(order.providerUpdatedAt))return false;
        if(order.status==='refunded'&&snapshot.status!=='refunded')return false;
        if(order.status==='charged_back'&&!['charged_back','refunded'].includes(snapshot.status))return false;
        if(order.status==='partially_refunded'&&!['partially_refunded','refunded','charged_back','in_mediation'].includes(snapshot.status))return false;
        if(order.status==='paid'&&!['paid','partially_refunded','refunded','in_mediation','charged_back'].includes(snapshot.status))return false;
        if(order.status==='in_mediation'&&!['in_mediation','paid','partially_refunded','refunded','charged_back'].includes(snapshot.status))return false;
        const previousStatus=order.status,previousFulfillment=order.fulfillmentStatus||'awaiting_payment';
        order.status=snapshot.status;order.providerOrderId=snapshot.providerOrderId;order.paymentId=snapshot.paymentId;order.providerUpdatedAt=snapshot.updatedAt;order.providerStatusDetail=snapshot.detail;
        if(order.status==='paid'&&order.fulfillmentStatus==='awaiting_payment')order.fulfillmentStatus='paid';
        if(['refunded','partially_refunded','in_mediation','charged_back'].includes(order.status)&&!['delivered','cancelled'].includes(order.fulfillmentStatus))order.fulfillmentStatus='hold';
        if(['cancelled','failed'].includes(order.status)&&order.fulfillmentStatus==='awaiting_payment')order.fulfillmentStatus='cancelled';
        if(previousFulfillment!==order.fulfillmentStatus)addFulfillmentHistory(order,previousFulfillment,order.fulfillmentStatus,'payment');else order.fulfillmentUpdatedAt=new Date().toISOString();await saveWith(tx,order);
        if(order.status==='paid')await consumeReservationWith(tx,id);else if(['cancelled','failed'].includes(order.status))await releaseReservationWith(tx,id);
        await tx`INSERT INTO public.events (fingerprint,order_id,created_at) VALUES (${fingerprint},${id}::uuid,now()) ON CONFLICT (fingerprint) DO NOTHING`;
        if(previousStatus!==order.status){
          if(order.status==='paid')await enqueueWith(tx,id,'order.paid');
          if(['refunded','partially_refunded','cancelled','failed','in_mediation','charged_back'].includes(order.status)){
            await tx`UPDATE public.outbox SET state='blocked' WHERE order_id=${id}::uuid AND state='pending'`;
            const kind=['refunded','partially_refunded'].includes(order.status)?'order.refunded':['in_mediation','charged_back'].includes(order.status)?'order.financial_hold':'order.cancelled';await enqueueWith(tx,id,kind);
          }
        }
        return true;
      });
    },
    async updateFulfillment(id,{fulfillmentStatus,trackingCode='',adminNotes=''}){
      return sql.begin(async tx=>{const order=await getWith(tx,id,{lock:true});if(!order)return null;const previous=order.fulfillmentStatus||'awaiting_payment';order.fulfillmentStatus=fulfillmentStatus;order.trackingCode=trackingCode;order.adminNotes=adminNotes;if(previous!==fulfillmentStatus)addFulfillmentHistory(order,previous,fulfillmentStatus,'admin');else order.fulfillmentUpdatedAt=new Date().toISOString();await saveWith(tx,order);if(previous!==fulfillmentStatus&&fulfillmentStatus==='shipped')await enqueueWith(tx,id,'order.shipped');if(previous!==fulfillmentStatus&&fulfillmentStatus==='delivered')await enqueueWith(tx,id,'order.delivered');return order;});
    },
    async listOrders({q='',status='',fulfillment='',from='',to='',limit=200}={}){
      const needle=q.trim().toLowerCase(),fromMs=from?Date.parse(from+'T00:00:00'):NaN,toMs=to?Date.parse(to+'T23:59:59.999'):NaN;
      const orders=await orderList(Math.max(limit*5,500));
      return orders.filter(order=>{
        const time=Date.parse(order.createdAt);if(Number.isFinite(fromMs)&&time<fromMs)return false;if(Number.isFinite(toMs)&&time>toMs)return false;
        if(status&&order.status!==status)return false;if(fulfillment&&order.fulfillmentStatus!==fulfillment)return false;
        if(needle){const c=order.customer||{};const hay=[order.orderId,order.orderCode,order.paymentId,order.providerOrderId,c.name,c.email,c.phone].join(' ').toLowerCase();if(!hay.includes(needle))return false;}
        return true;
      }).slice(0,limit);
    },
    async listCustomers({q='',limit=200}={}){
      const needle=q.trim().toLowerCase(),orders=await orderList(5000),stats=new Map();
      for(const order of orders){const id=order.customer?.customerId;if(!id)continue;const current=stats.get(id)||{orders:0,totalSpent:0,lastOrderAt:null};current.orders++;if(order.status==='paid')current.totalSpent+=Number(order.total||0);if(!current.lastOrderAt||Date.parse(order.createdAt)>Date.parse(current.lastOrderAt))current.lastOrderAt=order.createdAt;stats.set(id,current);}
      const n=Math.max(limit*3,500);const rows=await sql`SELECT id,name,email,phone,created_at,updated_at FROM public.customers ORDER BY updated_at DESC LIMIT ${Math.min(n,1500)}`;
      return rows.map(c=>({customerId:String(c.id),name:c.name,email:c.email,phone:c.phone,createdAt:iso(c.created_at),updatedAt:iso(c.updated_at)})).filter(customer=>!needle||[customer.name,customer.email,customer.phone,customer.customerId].join(' ').toLowerCase().includes(needle)).slice(0,limit).map(customer=>({...customer,...(stats.get(customer.customerId)||{orders:0,totalSpent:0,lastOrderAt:null})}));
    },
    async getCustomerDetail(customerId){
      const rows=await sql`SELECT id,name,email,phone,created_at,updated_at FROM public.customers WHERE id=${customerId}::uuid LIMIT 1`;if(!rows[0])return null;const c=rows[0],customer={customerId:String(c.id),name:c.name,email:c.email,phone:c.phone,createdAt:iso(c.created_at),updatedAt:iso(c.updated_at)},orders=(await orderList(5000)).filter(order=>order.customer?.customerId===customerId),seen=new Set(),addresses=[];
      for(const order of orders){const a=order.address;if(!a)continue;const key=JSON.stringify([a.cep,a.street,a.number,a.complement,a.district,a.city,a.state]);if(seen.has(key))continue;seen.add(key);addresses.push({...a,lastUsedAt:order.createdAt});}
      return {customer,orders,addresses};
    },
    async appendAudit({orderId=null,customerId=null,actor='admin',action,detail={}}){const rows=await sql`INSERT INTO public.audit_log (order_id,customer_id,actor,action,detail,created_at) VALUES (${orderId}::uuid,${customerId}::uuid,${actor},${action},${JSON.stringify(detail)}::jsonb,now()) RETURNING id,order_id,customer_id,actor,action,detail,created_at`;const r=rows[0];return {id:String(r.id),orderId:r.order_id?String(r.order_id):null,customerId:r.customer_id?String(r.customer_id):null,actor:r.actor,action:r.action,detail:decode(r.detail)||{},createdAt:iso(r.created_at)};},
    async listAudit({limit=200}={}){const n=Math.min(Math.max(Number(limit)||200,1),500),rows=await sql`SELECT id,order_id,customer_id,actor,action,detail,created_at FROM public.audit_log ORDER BY created_at DESC LIMIT ${n}`;return rows.map(r=>({id:String(r.id),orderId:r.order_id?String(r.order_id):null,customerId:r.customer_id?String(r.customer_id):null,actor:r.actor,action:r.action,detail:decode(r.detail)||{},createdAt:iso(r.created_at)}));},
    async listInventory(catalog=[]){await sql.begin(releaseExpiredWith);const rows=await sql`SELECT product_id,quantity,minimum_quantity,enabled,updated_at FROM public.inventory`,map=new Map(rows.map(r=>[r.product_id,r]));return catalog.map(product=>{const r=map.get(product.productId),quantity=r?.quantity??null,minimumQuantity=Number(r?.minimum_quantity||0),enabled=Boolean(r?.enabled);return {productId:product.productId,name:product.name,quantity,minimumQuantity,enabled,lowStock:enabled&&quantity!==null&&quantity<=minimumQuantity,updatedAt:r?.updated_at?iso(r.updated_at):null};});},
    async updateInventory(productId,{quantity=null,minimumQuantity=0,enabled=false}){const rows=await sql`INSERT INTO public.inventory (product_id,quantity,minimum_quantity,enabled,updated_at) VALUES (${productId},${quantity},${minimumQuantity},${enabled},now()) ON CONFLICT (product_id) DO UPDATE SET quantity=excluded.quantity,minimum_quantity=excluded.minimum_quantity,enabled=excluded.enabled,updated_at=now() RETURNING product_id,quantity,minimum_quantity,enabled,updated_at`;const r=rows[0];return {productId:r.product_id,quantity:r.quantity??null,minimumQuantity:Number(r.minimum_quantity||0),enabled:Boolean(r.enabled),lowStock:Boolean(r.enabled)&&r.quantity!==null&&r.quantity<=r.minimum_quantity,updatedAt:iso(r.updated_at)};},
    async enqueueOutbox(orderId,kind){await enqueueWith(sql,orderId,kind);},
    async listPendingOutbox(orderId,{limit=20}={}){const n=Math.min(Math.max(Number(limit)||20,1),100),rows=await sql`SELECT id,order_id,kind,state,created_at FROM public.outbox WHERE order_id=${orderId}::uuid AND state='pending' ORDER BY created_at ASC LIMIT ${n}`;return rows.map(r=>({id:String(r.id),orderId:String(r.order_id),kind:r.kind,state:r.state,createdAt:iso(r.created_at)}));},
    async markOutbox(id,state){await sql`UPDATE public.outbox SET state=${state} WHERE id=${id}::uuid`;},
    async recordAnalytics({event,path='/',productId=null,dedupeKey=null}){const id=randomUUID();await sql`INSERT INTO public.analytics_events (id,event,path,product_id,dedupe_key,created_at) VALUES (${id}::uuid,${event},${path},${productId},${dedupeKey},now()) ON CONFLICT (dedupe_key) DO NOTHING`;return {id,event,path,productId,dedupeKey,createdAt:new Date().toISOString()};},
    async analyticsSummary({days=30}={}){const safeDays=Math.min(Math.max(Number(days)||30,1),365),since=new Date(Date.now()-safeDays*86400000),rows=await sql`SELECT event,count(*)::int AS count FROM public.analytics_events WHERE created_at>=${since} GROUP BY event`,events=Object.fromEntries(rows.map(r=>[r.event,Number(r.count)]));return {days:safeDays,events,total:Object.values(events).reduce((a,b)=>a+b,0)};},
    async removeExpiredShippingQuotes(){await sql`DELETE FROM public.shipping_quotes WHERE expires_at<now()`;},
    async saveShippingQuote({quoteId,owner,document,expiresAt}){await sql`INSERT INTO public.shipping_quotes (id,owner,document,expires_at,created_at) VALUES (${quoteId}::uuid,${owner},${JSON.stringify(document)}::jsonb,${new Date(expiresAt)},now())`;},
    async getShippingQuote(owner,id){const rows=await sql`SELECT document,expires_at FROM public.shipping_quotes WHERE id=${id}::uuid AND owner=${owner}`;return rows[0]?{document:decode(rows[0].document),expires:new Date(rows[0].expires_at).getTime()}:null;}
  };
}
