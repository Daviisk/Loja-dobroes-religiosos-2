import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {fail} from './validation.js';
export const hash=value=>createHash('sha256').update(value).digest('hex');
const decode=row=>row?JSON.parse(row.document):null;
const terminal=new Set(['paid','cancelled','refunded','partially_refunded','failed','charged_back']);
export function openStore(filename){
  if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true,mode:0o700});
  const db=new DatabaseSync(filename);if(filename!==':memory:')chmodSync(filename,0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, owner TEXT NOT NULL, cart_hash TEXT NOT NULL,
      active_key TEXT UNIQUE, provider_id TEXT UNIQUE, document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (owner TEXT NOT NULL, key TEXT NOT NULL, cart_hash TEXT NOT NULL,
      order_id TEXT NOT NULL, PRIMARY KEY(owner,key));
    CREATE TABLE IF NOT EXISTS events (fingerprint TEXT PRIMARY KEY, order_id TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, kind TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, UNIQUE(order_id,kind));
    CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, email_key TEXT UNIQUE NOT NULL, phone_key TEXT NOT NULL,
      document TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone_key);
    CREATE TABLE IF NOT EXISTS shipping_quotes (id TEXT PRIMARY KEY, owner TEXT NOT NULL, document TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
    INSERT OR IGNORE INTO counters(name,value) VALUES ('order_number',1000);
    CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, order_id TEXT, customer_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_log_order_id_idx ON audit_log(order_id);
    CREATE TABLE IF NOT EXISTS inventory (product_id TEXT PRIMARY KEY, quantity INTEGER, minimum_quantity INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inventory_reservations (order_id TEXT PRIMARY KEY, document TEXT NOT NULL, expires INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'reserved', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS inventory_reservations_expiry_idx ON inventory_reservations(state,expires);
    CREATE TABLE IF NOT EXISTS analytics_events (id TEXT PRIMARY KEY, event TEXT NOT NULL, path TEXT NOT NULL, product_id TEXT, dedupe_key TEXT UNIQUE, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON analytics_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS analytics_events_event_idx ON analytics_events(event,created_at DESC);`);
  function tx(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
  function get(id){return decode(db.prepare('SELECT document FROM orders WHERE id=?').get(id));}
  function save(order){db.prepare('UPDATE orders SET provider_id=?,active_key=?,document=? WHERE id=?').run(order.providerOrderId,terminal.has(order.status)?null:order.owner+':'+order.cartHash,JSON.stringify(order),order.orderId);}
  function orderList(limit=1000){return db.prepare('SELECT document FROM orders ORDER BY rowid DESC LIMIT ?').all(limit).map(decode).filter(Boolean);}
  function nextOrderCode(){const row=db.prepare("SELECT value FROM counters WHERE name='order_number'").get(),next=Number(row?.value||1000)+1;db.prepare("UPDATE counters SET value=? WHERE name='order_number'").run(next);return String(next);}
  function addFulfillmentHistory(order,from,to,source){if(from===to)return;const at=new Date().toISOString();order.fulfillmentHistory=Array.isArray(order.fulfillmentHistory)?order.fulfillmentHistory:[];order.fulfillmentHistory.push({from:from??null,to,at,source});order.fulfillmentUpdatedAt=at;}
  function enqueueOutbox(orderId,kind){db.prepare("INSERT OR IGNORE INTO outbox(id,order_id,kind,state,created_at) VALUES (?,?,?,'pending',?)").run(randomUUID(),orderId,kind,new Date().toISOString());}
  function restoreReservation(row){
    if(!row||row.state!=='reserved')return false;
    const document=JSON.parse(row.document||'{}');for(const item of document.items||[])db.prepare('UPDATE inventory SET quantity=COALESCE(quantity,0)+?,updated_at=? WHERE product_id=?').run(Number(item.quantity||0),new Date().toISOString(),item.productId);
    db.prepare("UPDATE inventory_reservations SET state='released',updated_at=? WHERE order_id=? AND state='reserved'").run(new Date().toISOString(),row.order_id);return true;
  }
  function releaseExpiredReservations(now=Date.now()){
    const rows=db.prepare("SELECT * FROM inventory_reservations WHERE state='reserved' AND expires<=?").all(now);for(const row of rows)restoreReservation(row);
  }
  function consumeReservation(orderId){db.prepare("UPDATE inventory_reservations SET state='consumed',updated_at=? WHERE order_id=? AND state='reserved'").run(new Date().toISOString(),orderId);}
  function releaseReservation(orderId){const row=db.prepare('SELECT * FROM inventory_reservations WHERE order_id=?').get(orderId);return restoreReservation(row);}
  function customerDetail(customerId){
    const row=db.prepare('SELECT document FROM customers WHERE id=?').get(customerId);if(!row)return null;
    const customer=decode(row),orders=orderList(5000).filter(order=>order.customer?.customerId===customerId),seen=new Set(),addresses=[];
    for(const order of orders){const a=order.address;if(!a)continue;const key=JSON.stringify([a.cep,a.street,a.number,a.complement,a.district,a.city,a.state]);if(seen.has(key))continue;seen.add(key);addresses.push({...a,lastUsedAt:order.createdAt});}
    return {customer,orders,addresses};
  }
  return {
    kind:'sqlite',db,tx,get,save,close:()=>db.close(),ping:()=>db.prepare('SELECT 1 ok').get().ok===1,
    session(raw){if(!/^[a-f0-9]{64}$/.test(raw||''))return null;return db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(hash(raw),Date.now())||null;},
    newSession(){db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());const raw=randomBytes(32).toString('hex'),session={id:hash(raw),csrf:randomBytes(32).toString('hex'),expires:Date.now()+7*86400000};db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(session.id,session.csrf,session.expires);return {...session,raw};},
    upsertCustomer(input){return tx(()=>{
      const email=String(input.email||'').trim().toLowerCase(),phone=String(input.phone||'').replace(/\D/g,''),name=String(input.name||'').trim();
      let row=db.prepare('SELECT * FROM customers WHERE email_key=?').get(email);if(!row&&phone)row=db.prepare('SELECT * FROM customers WHERE phone_key=? ORDER BY updated_at DESC LIMIT 1').get(phone);
      const now=new Date().toISOString();
      if(row){const current=decode(row),customer={...current,name,email,phone,updatedAt:now};db.prepare('UPDATE customers SET email_key=?,phone_key=?,document=?,updated_at=? WHERE id=?').run(email,phone,JSON.stringify(customer),now,row.id);return customer;}
      const customer={customerId:randomUUID(),name,email,phone,createdAt:now,updatedAt:now};db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?)').run(customer.customerId,email,phone,JSON.stringify(customer),now,now);return customer;
    });},
    findRequest(owner,key,cartHash){const r=db.prepare('SELECT * FROM requests WHERE owner=? AND key=?').get(owner,key);if(!r)return null;if(r.cart_hash!==cartHash)fail(409,'idempotency_conflict','Esta tentativa já foi usada com outro carrinho.');return get(r.order_id);},
    obtain(owner,key,cart,totals,payloadFactory){return tx(()=>{
      let order=this.findRequest(owner,key,cart.hash);if(order)return order;
      order=decode(db.prepare('SELECT document FROM orders WHERE active_key=?').get(owner+':'+cart.hash));
      if(order&&Date.now()-Date.parse(order.createdAt)>86400000)fail(409,'order_needs_review','Há um pedido antigo aguardando conferência. Entre em contato com a loja.');
      if(!order){
        const orderId=randomUUID(),createdAt=new Date().toISOString(),orderCode=nextOrderCode();
        order={orderId,orderCode,owner,cartHash:cart.hash,...totals,status:'pending',fulfillmentStatus:'awaiting_payment',fulfillmentHistory:[{from:null,to:'awaiting_payment',at:createdAt,source:'system'}],trackingCode:'',adminNotes:'',fulfillmentUpdatedAt:createdAt,createdAt,paymentProvider:'mercadopago',paymentId:null,providerOrderId:null,checkoutUrl:null,providerUpdatedAt:null,checkoutState:'creating',lastError:null,paymentAttemptKey:null};
        order.gatewayPayload=payloadFactory(order);
        db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?)').run(order.orderId,owner,cart.hash,owner+':'+cart.hash,null,JSON.stringify(order));enqueueOutbox(order.orderId,'order.created');
      }
      db.prepare('INSERT INTO requests VALUES (?,?,?,?)').run(owner,key,cart.hash,order.orderId);return order;
    });},
    reserveInventory(orderId,items,expiresAt){return tx(()=>{
      releaseExpiredReservations();const existing=db.prepare('SELECT * FROM inventory_reservations WHERE order_id=?').get(orderId);if(existing){if(['reserved','consumed'].includes(existing.state))return {state:existing.state,orderId};fail(409,'stock_reservation_expired','A reserva de estoque deste pedido expirou. Inicie uma nova compra.');}
      const clean=(items||[]).map(item=>({productId:String(item.productId),quantity:Number(item.quantity)}));
      for(const item of clean){const row=db.prepare('SELECT quantity,enabled FROM inventory WHERE product_id=?').get(item.productId);if(!row||!row.enabled||row.quantity===null||row.quantity===undefined)fail(503,'stock_not_configured','O estoque deste produto ainda não foi configurado para venda.');if(!Number.isInteger(item.quantity)||item.quantity<1||Number(row.quantity)<item.quantity)fail(409,'out_of_stock','A quantidade solicitada não está mais disponível em estoque.');}
      const now=new Date().toISOString();for(const item of clean)db.prepare('UPDATE inventory SET quantity=quantity-?,updated_at=? WHERE product_id=?').run(item.quantity,now,item.productId);db.prepare("INSERT INTO inventory_reservations(order_id,document,expires,state,created_at,updated_at) VALUES (?,?,?,'reserved',?,?)").run(orderId,JSON.stringify({items:clean}),expiresAt,now,now);return {state:'reserved',orderId};
    });},
    releaseInventory(orderId){return tx(()=>releaseReservation(orderId));},
    consumeInventory(orderId){return tx(()=>{consumeReservation(orderId);return true;});},
    applySnapshot(id,snapshot){return tx(()=>{
      const order=get(id);if(!order)return false;
      const fingerprint=hash(JSON.stringify([snapshot.providerOrderId,snapshot.updatedAt,snapshot.status,snapshot.detail]));
      if(db.prepare('SELECT 1 FROM events WHERE fingerprint=?').get(fingerprint))return false;
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
      if(previousFulfillment!==order.fulfillmentStatus)addFulfillmentHistory(order,previousFulfillment,order.fulfillmentStatus,'payment');else order.fulfillmentUpdatedAt=new Date().toISOString();save(order);
      if(order.status==='paid')consumeReservation(id);else if(['cancelled','failed'].includes(order.status))releaseReservation(id);
      db.prepare('INSERT INTO events VALUES (?,?,?)').run(fingerprint,id,new Date().toISOString());
      if(previousStatus!==order.status){
        if(order.status==='paid')enqueueOutbox(id,'order.paid');
        if(['refunded','partially_refunded','cancelled','failed','in_mediation','charged_back'].includes(order.status)){
          db.prepare("UPDATE outbox SET state='blocked' WHERE order_id=? AND state='pending'").run(id);
          const kind=['refunded','partially_refunded'].includes(order.status)?'order.refunded':['in_mediation','charged_back'].includes(order.status)?'order.financial_hold':'order.cancelled';enqueueOutbox(id,kind);
        }
      }
      return true;
    });},
    updateFulfillment(id,{fulfillmentStatus,trackingCode='',adminNotes=''}){return tx(()=>{const order=get(id);if(!order)return null;const previous=order.fulfillmentStatus||'awaiting_payment';order.fulfillmentStatus=fulfillmentStatus;order.trackingCode=trackingCode;order.adminNotes=adminNotes;if(previous!==fulfillmentStatus)addFulfillmentHistory(order,previous,fulfillmentStatus,'admin');else order.fulfillmentUpdatedAt=new Date().toISOString();save(order);if(previous!==fulfillmentStatus&&fulfillmentStatus==='shipped')enqueueOutbox(id,'order.shipped');if(previous!==fulfillmentStatus&&fulfillmentStatus==='delivered')enqueueOutbox(id,'order.delivered');return order;});},
    listOrders({q='',status='',fulfillment='',from='',to='',limit=200}={}){
      const needle=q.trim().toLowerCase(),fromMs=from?Date.parse(from+'T00:00:00'):NaN,toMs=to?Date.parse(to+'T23:59:59.999'):NaN;
      return orderList(Math.max(limit*5,500)).filter(order=>{
        const time=Date.parse(order.createdAt);if(Number.isFinite(fromMs)&&time<fromMs)return false;if(Number.isFinite(toMs)&&time>toMs)return false;
        if(status&&order.status!==status)return false;if(fulfillment&&order.fulfillmentStatus!==fulfillment)return false;
        if(needle){const c=order.customer||{};const hay=[order.orderId,order.orderCode,order.paymentId,order.providerOrderId,c.name,c.email,c.phone].join(' ').toLowerCase();if(!hay.includes(needle))return false;}
        return true;
      }).slice(0,limit);
    },
    listCustomers({q='',limit=200}={}){
      const needle=q.trim().toLowerCase(),orders=orderList(5000),stats=new Map();
      for(const order of orders){const id=order.customer?.customerId;if(!id)continue;const current=stats.get(id)||{orders:0,totalSpent:0,lastOrderAt:null};current.orders++;if(order.status==='paid')current.totalSpent+=Number(order.total||0);if(!current.lastOrderAt||Date.parse(order.createdAt)>Date.parse(current.lastOrderAt))current.lastOrderAt=order.createdAt;stats.set(id,current);}
      return db.prepare('SELECT document FROM customers ORDER BY updated_at DESC LIMIT ?').all(Math.max(limit*3,500)).map(decode).filter(Boolean).filter(customer=>!needle||[customer.name,customer.email,customer.phone,customer.customerId].join(' ').toLowerCase().includes(needle)).slice(0,limit).map(customer=>({...customer,...(stats.get(customer.customerId)||{orders:0,totalSpent:0,lastOrderAt:null})}));
    },
    getCustomerDetail(customerId){return customerDetail(customerId);},
    appendAudit({orderId=null,customerId=null,actor='admin',action,detail={}}){const row={id:randomUUID(),orderId,customerId,actor,action,detail,createdAt:new Date().toISOString()};db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?,?,?)').run(row.id,row.orderId,row.customerId,row.actor,row.action,JSON.stringify(row.detail),row.createdAt);return row;},
    listAudit({limit=200}={}){return db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(Math.min(Math.max(Number(limit)||200,1),500)).map(r=>({id:r.id,orderId:r.order_id,customerId:r.customer_id,actor:r.actor,action:r.action,detail:JSON.parse(r.detail||'{}'),createdAt:r.created_at}));},
    listInventory(catalog=[]){releaseExpiredReservations();const rows=new Map(db.prepare('SELECT * FROM inventory').all().map(r=>[r.product_id,r]));return catalog.map(product=>{const r=rows.get(product.productId);const quantity=r?.quantity??null,minimumQuantity=Number(r?.minimum_quantity||0),enabled=Boolean(r?.enabled);return {productId:product.productId,name:product.name,quantity,minimumQuantity,enabled,lowStock:enabled&&quantity!==null&&quantity<=minimumQuantity,updatedAt:r?.updated_at||null};});},
    updateInventory(productId,{quantity=null,minimumQuantity=0,enabled=false}){const now=new Date().toISOString();db.prepare('INSERT INTO inventory(product_id,quantity,minimum_quantity,enabled,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET quantity=excluded.quantity,minimum_quantity=excluded.minimum_quantity,enabled=excluded.enabled,updated_at=excluded.updated_at').run(productId,quantity,minimumQuantity,enabled?1:0,now);return {productId,quantity,minimumQuantity,enabled:Boolean(enabled),lowStock:Boolean(enabled)&&quantity!==null&&quantity<=minimumQuantity,updatedAt:now};},
    enqueueOutbox(orderId,kind){enqueueOutbox(orderId,kind);},
    listPendingOutbox(orderId,{limit=20}={}){return db.prepare("SELECT id,order_id,kind,state,created_at FROM outbox WHERE order_id=? AND state='pending' ORDER BY created_at ASC LIMIT ?").all(orderId,Math.min(Math.max(Number(limit)||20,1),100)).map(r=>({id:r.id,orderId:r.order_id,kind:r.kind,state:r.state,createdAt:r.created_at}));},
    markOutbox(id,state){db.prepare('UPDATE outbox SET state=? WHERE id=?').run(state,id);},
    recordAnalytics({event,path='/',productId=null,dedupeKey=null}){const row={id:randomUUID(),event,path,productId,dedupeKey,createdAt:new Date().toISOString()};db.prepare('INSERT OR IGNORE INTO analytics_events(id,event,path,product_id,dedupe_key,created_at) VALUES (?,?,?,?,?,?)').run(row.id,row.event,row.path,row.productId,row.dedupeKey,row.createdAt);return row;},
    analyticsSummary({days=30}={}){const safeDays=Math.min(Math.max(Number(days)||30,1),365),since=new Date(Date.now()-safeDays*86400000).toISOString();const rows=db.prepare('SELECT event,count(*) count FROM analytics_events WHERE created_at>=? GROUP BY event').all(since),events=Object.fromEntries(rows.map(r=>[r.event,Number(r.count)]));return {days:safeDays,events,total:Object.values(events).reduce((a,b)=>a+b,0)};},
    removeExpiredShippingQuotes(now=Date.now()){db.prepare('DELETE FROM shipping_quotes WHERE expires < ?').run(now);},
    saveShippingQuote({quoteId,owner,document,expiresAt}){db.prepare('INSERT INTO shipping_quotes VALUES (?,?,?,?)').run(quoteId,owner,JSON.stringify(document),expiresAt);},
    getShippingQuote(owner,id){return db.prepare('SELECT document,expires FROM shipping_quotes WHERE id=? AND owner=?').get(id,owner)||null;}
  };
}
