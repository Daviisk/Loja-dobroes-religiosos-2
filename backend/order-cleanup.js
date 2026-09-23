const DEFAULT_TIMEOUT_MINUTES=30;
const MAX_TIMEOUT_MINUTES=24*60;

export function orderCleanupTimeoutMs(env=process.env){
  const raw=String(env.ABANDONED_ORDER_TIMEOUT_MINUTES??DEFAULT_TIMEOUT_MINUTES).trim();
  const minutes=Number(raw);
  if(!Number.isInteger(minutes)||minutes<1||minutes>MAX_TIMEOUT_MINUTES)throw Error('ABANDONED_ORDER_TIMEOUT_MINUTES deve ser um número inteiro entre 1 e 1440.');
  return minutes*60*1000;
}

function isAbandoned(order,cutoff){
  if(!order||order.status!=='pending')return false;
  if((order.fulfillmentStatus||'awaiting_payment')!=='awaiting_payment')return false;
  if(order.paymentAttemptKey||order.providerOrderId||order.paymentId)return false;
  const createdAt=Date.parse(order.createdAt);
  return Number.isFinite(createdAt)&&createdAt<cutoff;
}

export async function deleteAbandonedOrders(store,{ttlMs=orderCleanupTimeoutMs(),now=Date.now()}={}){
  if(!Number.isFinite(ttlMs)||ttlMs<60000)throw Error('TTL de pedidos abandonados inválido.');
  const cutoff=now-ttlMs;

  if(store?.kind==='postgres'&&store.sql){
    const rows=await store.sql`
      DELETE FROM public.orders
      WHERE created_at < ${new Date(cutoff)}
        AND provider_id IS NULL
        AND COALESCE(document->>'status','') = 'pending'
        AND COALESCE(document->>'fulfillmentStatus','awaiting_payment') = 'awaiting_payment'
        AND COALESCE(document->>'paymentAttemptKey','') = ''
        AND COALESCE(document->>'providerOrderId','') = ''
        AND COALESCE(document->>'paymentId','') = ''
      RETURNING id
    `;
    return rows.length;
  }

  if(store?.kind==='sqlite'&&store.db&&store.tx){
    return store.tx(()=>{
      const rows=store.db.prepare('SELECT id,document FROM orders').all();
      const stale=[];
      for(const row of rows){
        let order=null;try{order=JSON.parse(row.document);}catch{}
        if(isAbandoned(order,cutoff))stale.push(row.id);
      }
      const delRequests=store.db.prepare('DELETE FROM requests WHERE order_id=?');
      const delEvents=store.db.prepare('DELETE FROM events WHERE order_id=?');
      const delOutbox=store.db.prepare('DELETE FROM outbox WHERE order_id=?');
      const delOrder=store.db.prepare('DELETE FROM orders WHERE id=?');
      for(const id of stale){delRequests.run(id);delEvents.run(id);delOutbox.run(id);delOrder.run(id);}
      return stale.length;
    });
  }

  return 0;
}

export function createOrderCleanupRunner(store,{ttlMs=orderCleanupTimeoutMs(),intervalMs=60000,logger=console}={}){
  let nextRun=0,inFlight=null;
  return async function run(now=Date.now()){
    if(inFlight)return inFlight;
    if(now<nextRun)return 0;
    nextRun=now+intervalMs;
    inFlight=deleteAbandonedOrders(store,{ttlMs,now})
      .then(count=>{if(count>0)logger.info?.(JSON.stringify({event:'abandoned_orders_deleted',count,timeoutMinutes:Math.round(ttlMs/60000)}));return count;})
      .catch(error=>{logger.error?.(JSON.stringify({event:'abandoned_order_cleanup_failed',error:String(error?.message||'cleanup_error')}));return 0;})
      .finally(()=>{inFlight=null;});
    return inFlight;
  };
}
