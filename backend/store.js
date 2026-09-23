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
    INSERT OR IGNORE INTO counters(name,value) VALUES ('order_number',1000);`);
  function tx(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
  function get(id){return decode(db.prepare('SELECT document FROM orders WHERE id=?').get(id));}
  function save(order){db.prepare('UPDATE orders SET provider_id=?,active_key=?,document=? WHERE id=?').run(order.providerOrderId,terminal.has(order.status)?null:order.owner+':'+order.cartHash,JSON.stringify(order),order.orderId);}
  function orderList(limit=1000){return db.prepare('SELECT document FROM orders ORDER BY rowid DESC LIMIT ?').all(limit).map(decode).filter(Boolean);}
  function nextOrderCode(){const row=db.prepare("SELECT value FROM counters WHERE name='order_number'").get(),next=Number(row?.value||1000)+1;db.prepare("UPDATE counters SET value=? WHERE name='order_number'").run(next);return String(next);}
  function addFulfillmentHistory(order,from,to,source){if(from===to)return;const at=new Date().toISOString();order.fulfillmentHistory=Array.isArray(order.fulfillmentHistory)?order.fulfillmentHistory:[];order.fulfillmentHistory.push({from:from??null,to,at,source});order.fulfillmentUpdatedAt=at;}
  return {
    kind:'sqlite',db,tx,get,save,close:()=>db.close(),
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
        db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?)').run(order.orderId,owner,cart.hash,owner+':'+cart.hash,null,JSON.stringify(order));
      }
      db.prepare('INSERT INTO requests VALUES (?,?,?,?)').run(owner,key,cart.hash,order.orderId);return order;
    });},
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
      const previousFulfillment=order.fulfillmentStatus||'awaiting_payment';
      order.status=snapshot.status;order.providerOrderId=snapshot.providerOrderId;order.paymentId=snapshot.paymentId;order.providerUpdatedAt=snapshot.updatedAt;order.providerStatusDetail=snapshot.detail;
      if(order.status==='paid'&&order.fulfillmentStatus==='awaiting_payment')order.fulfillmentStatus='paid';
      if(['refunded','partially_refunded','in_mediation','charged_back'].includes(order.status)&&!['delivered','cancelled'].includes(order.fulfillmentStatus))order.fulfillmentStatus='hold';
      if(['cancelled','failed'].includes(order.status)&&order.fulfillmentStatus==='awaiting_payment')order.fulfillmentStatus='cancelled';
      if(previousFulfillment!==order.fulfillmentStatus)addFulfillmentHistory(order,previousFulfillment,order.fulfillmentStatus,'payment');else order.fulfillmentUpdatedAt=new Date().toISOString();save(order);
      db.prepare('INSERT INTO events VALUES (?,?,?)').run(fingerprint,id,new Date().toISOString());
      if(order.status==='paid')db.prepare("INSERT OR IGNORE INTO outbox(id,order_id,kind,created_at) VALUES (?,?, 'order.paid',?)").run(randomUUID(),id,new Date().toISOString());
      if(['refunded','partially_refunded','cancelled','in_mediation','charged_back'].includes(order.status))db.prepare("UPDATE outbox SET state='blocked' WHERE order_id=? AND state='pending'").run(id);
      return true;
    });},
    updateFulfillment(id,{fulfillmentStatus,trackingCode='',adminNotes=''}){return tx(()=>{const order=get(id);if(!order)return null;const previous=order.fulfillmentStatus||'awaiting_payment';order.fulfillmentStatus=fulfillmentStatus;order.trackingCode=trackingCode;order.adminNotes=adminNotes;if(previous!==fulfillmentStatus)addFulfillmentHistory(order,previous,fulfillmentStatus,'admin');else order.fulfillmentUpdatedAt=new Date().toISOString();save(order);return order;});},
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
    removeExpiredShippingQuotes(now=Date.now()){db.prepare('DELETE FROM shipping_quotes WHERE expires < ?').run(now);},
    saveShippingQuote({quoteId,owner,document,expiresAt}){db.prepare('INSERT INTO shipping_quotes VALUES (?,?,?,?)').run(quoteId,owner,JSON.stringify(document),expiresAt);},
    getShippingQuote(owner,id){return db.prepare('SELECT document,expires FROM shipping_quotes WHERE id=? AND owner=?').get(id,owner)||null;}
  };
}
