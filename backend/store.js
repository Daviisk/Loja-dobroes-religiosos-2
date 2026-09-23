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
      state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, UNIQUE(order_id,kind));`);
  function tx(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
  function get(id){return decode(db.prepare('SELECT document FROM orders WHERE id=?').get(id));}
  function save(order){db.prepare('UPDATE orders SET provider_id=?,active_key=?,document=? WHERE id=?').run(order.providerOrderId,terminal.has(order.status)?null:order.owner+':'+order.cartHash,JSON.stringify(order),order.orderId);}
  return {
    db,tx,get,save,close:()=>db.close(),
    session(raw){if(!/^[a-f0-9]{64}$/.test(raw||''))return null;return db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(hash(raw),Date.now())||null;},
    newSession(){db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());const raw=randomBytes(32).toString('hex'),session={id:hash(raw),csrf:randomBytes(32).toString('hex'),expires:Date.now()+7*86400000};db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(session.id,session.csrf,session.expires);return {...session,raw};},
    findRequest(owner,key,cartHash){const r=db.prepare('SELECT * FROM requests WHERE owner=? AND key=?').get(owner,key);if(!r)return null;if(r.cart_hash!==cartHash)fail(409,'idempotency_conflict','Esta tentativa já foi usada com outro carrinho.');return get(r.order_id);},
    obtain(owner,key,cart,totals,payloadFactory){return tx(()=>{
      let order=this.findRequest(owner,key,cart.hash);if(order)return order;
      order=decode(db.prepare('SELECT document FROM orders WHERE active_key=?').get(owner+':'+cart.hash));
      if(order&&Date.now()-Date.parse(order.createdAt)>86400000)fail(409,'order_needs_review','Há um pedido antigo aguardando conferência. Entre em contato com a loja.');
      if(!order){
        order={orderId:randomUUID(),owner,cartHash:cart.hash,...totals,status:'pending',createdAt:new Date().toISOString(),paymentProvider:'mercadopago',paymentId:null,providerOrderId:null,checkoutUrl:null,providerUpdatedAt:null,checkoutState:'creating',lastError:null,paymentAttemptKey:null};
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
      // Financial end states cannot be silently downgraded by delayed notifications.
      if(order.status==='refunded'&&snapshot.status!=='refunded')return false;
      if(order.status==='charged_back'&&!['charged_back','refunded'].includes(snapshot.status))return false;
      if(order.status==='partially_refunded'&&!['partially_refunded','refunded','charged_back','in_mediation'].includes(snapshot.status))return false;
      if(order.status==='paid'&&!['paid','partially_refunded','refunded','in_mediation','charged_back'].includes(snapshot.status))return false;
      if(order.status==='in_mediation'&&!['in_mediation','paid','partially_refunded','refunded','charged_back'].includes(snapshot.status))return false;
      order.status=snapshot.status;order.providerOrderId=snapshot.providerOrderId;order.paymentId=snapshot.paymentId;order.providerUpdatedAt=snapshot.updatedAt;order.providerStatusDetail=snapshot.detail;
      save(order);
      db.prepare('INSERT INTO events VALUES (?,?,?)').run(fingerprint,id,new Date().toISOString());
      if(order.status==='paid')db.prepare("INSERT OR IGNORE INTO outbox(id,order_id,kind,created_at) VALUES (?,?, 'order.paid',?)").run(randomUUID(),id,new Date().toISOString());
      if(['refunded','partially_refunded','cancelled','in_mediation','charged_back'].includes(order.status))db.prepare("UPDATE outbox SET state='blocked' WHERE order_id=? AND state='pending'").run(id);
      return true;
    });}
  };
}
