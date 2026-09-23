import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../backend/store.js';
import {deleteAbandonedOrders,orderCleanupTimeoutMs} from '../backend/order-cleanup.js';

function insertOrder(store,{id,createdAt,status='pending',fulfillmentStatus='awaiting_payment',paymentAttemptKey=null,providerOrderId=null,paymentId=null}){
  const order={orderId:id,owner:'owner',cartHash:'cart-'+id,createdAt,status,fulfillmentStatus,paymentAttemptKey,providerOrderId,paymentId};
  store.db.prepare('INSERT INTO orders (id,owner,cart_hash,active_key,provider_id,document) VALUES (?,?,?,?,?,?)').run(id,'owner','cart-'+id,'owner:cart-'+id,providerOrderId,JSON.stringify(order));
  store.db.prepare('INSERT INTO requests (owner,key,cart_hash,order_id) VALUES (?,?,?,?)').run('owner','key-'+id,'cart-'+id,id);
  return order;
}

test('timeout padrão de pedido abandonado é 30 minutos e pode ser configurado',()=>{
  assert.equal(orderCleanupTimeoutMs({}),30*60*1000);
  assert.equal(orderCleanupTimeoutMs({ABANDONED_ORDER_TIMEOUT_MINUTES:'45'}),45*60*1000);
  assert.throws(()=>orderCleanupTimeoutMs({ABANDONED_ORDER_TIMEOUT_MINUTES:'0'}));
});

test('remove somente pedidos pending antigos sem tentativa de pagamento',async t=>{
  const store=openStore(':memory:');t.after(()=>store.close());
  const now=Date.parse('2026-09-20T17:30:00.000Z');
  insertOrder(store,{id:'stale',createdAt:new Date(now-31*60*1000).toISOString()});
  insertOrder(store,{id:'fresh',createdAt:new Date(now-29*60*1000).toISOString()});
  insertOrder(store,{id:'processing',createdAt:new Date(now-2*60*60*1000).toISOString(),status:'processing'});
  insertOrder(store,{id:'paid',createdAt:new Date(now-2*60*60*1000).toISOString(),status:'paid',fulfillmentStatus:'paid'});
  insertOrder(store,{id:'attempt',createdAt:new Date(now-2*60*60*1000).toISOString(),paymentAttemptKey:'attempt-key'});
  insertOrder(store,{id:'provider',createdAt:new Date(now-2*60*60*1000).toISOString(),providerOrderId:'123456789'});

  const deleted=await deleteAbandonedOrders(store,{ttlMs:30*60*1000,now});
  assert.equal(deleted,1);
  assert.equal(store.db.prepare('SELECT 1 FROM orders WHERE id=?').get('stale'),undefined);
  assert.equal(store.db.prepare('SELECT 1 FROM requests WHERE order_id=?').get('stale'),undefined);
  for(const id of ['fresh','processing','paid','attempt','provider'])assert.ok(store.db.prepare('SELECT 1 FROM orders WHERE id=?').get(id),id);
});
