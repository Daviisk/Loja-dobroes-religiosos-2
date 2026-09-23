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
          else order=decode(rows[0].document);
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
        const previousFulfillment=order.fulfillmentStatus||'awaiting_payment';
        order.status=snapshot.status;order.providerOrderId=snapshot.providerOrderId;order.paymentId=snapshot.paymentId;order.providerUpdatedAt=snapshot.updatedAt;order.providerStatusDetail=snapshot.detail;
        if(order.status==='paid'&&order.fulfillmentStatus==='awaiting_payment')order.fulfillmentStatus='paid';
        if(['refunded','partially_refunded','in_mediation','charged_back'].includes(order.status)&&!['delivered','cancelled'].includes(order.fulfillmentStatus))order.fulfillmentStatus='hold';
        if(['cancelled','failed'].includes(order.status)&&order.fulfillmentStatus==='awaiting_payment')order.fulfillmentStatus='cancelled';
        if(previousFulfillment!==order.fulfillmentStatus)addFulfillmentHistory(order,previousFulfillment,order.fulfillmentStatus,'payment');else order.fulfillmentUpdatedAt=new Date().toISOString();await saveWith(tx,order);
        await tx`INSERT INTO public.events (fingerprint,order_id,created_at) VALUES (${fingerprint},${id}::uuid,now()) ON CONFLICT (fingerprint) DO NOTHING`;
        if(order.status==='paid')await tx`INSERT INTO public.outbox (id,order_id,kind,state,created_at) VALUES (${randomUUID()}::uuid,${id}::uuid,'order.paid','pending',now()) ON CONFLICT (order_id,kind) DO NOTHING`;
        if(['refunded','partially_refunded','cancelled','in_mediation','charged_back'].includes(order.status))await tx`UPDATE public.outbox SET state='blocked' WHERE order_id=${id}::uuid AND state='pending'`;
        return true;
      });
    },
    async updateFulfillment(id,{fulfillmentStatus,trackingCode='',adminNotes=''}){
      return sql.begin(async tx=>{const order=await getWith(tx,id,{lock:true});if(!order)return null;const previous=order.fulfillmentStatus||'awaiting_payment';order.fulfillmentStatus=fulfillmentStatus;order.trackingCode=trackingCode;order.adminNotes=adminNotes;if(previous!==fulfillmentStatus)addFulfillmentHistory(order,previous,fulfillmentStatus,'admin');else order.fulfillmentUpdatedAt=new Date().toISOString();await saveWith(tx,order);return order;});
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
    async removeExpiredShippingQuotes(){await sql`DELETE FROM public.shipping_quotes WHERE expires_at<now()`;},
    async saveShippingQuote({quoteId,owner,document,expiresAt}){await sql`INSERT INTO public.shipping_quotes (id,owner,document,expires_at,created_at) VALUES (${quoteId}::uuid,${owner},${JSON.stringify(document)}::jsonb,${new Date(expiresAt)},now())`;},
    async getShippingQuote(owner,id){const rows=await sql`SELECT document,expires_at FROM public.shipping_quotes WHERE id=${id}::uuid AND owner=${owner}`;return rows[0]?{document:decode(rows[0].document),expires:new Date(rows[0].expires_at).getTime()}:null;}
  };
}
