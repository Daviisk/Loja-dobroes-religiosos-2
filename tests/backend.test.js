import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import request from 'supertest';
import {createApp} from '../backend/app.js';
import {openStore} from '../backend/store.js';
import {createGateway} from '../backend/services/mercadopago.js';
import {canonicalCart,calculate,cents,money} from '../backend/validation.js';
import {readConfig} from '../backend/config.js';

const catalog=[{productId:'produto_01',name:'Test item',priceCents:15000,enabled:true,maxQuantity:10}];
const items=[{productId:'produto_01',quantity:2}];
const address={cep:'01001000',street:'Praça da Sé',number:'1',complement:'',district:'Sé',city:'São Paulo',state:'SP'};
const customer={name:'Cliente Teste',phone:'11999999999',email:'buyer@example.com'};
const card={token:'test_card_token_1234567890',issuerId:'123',paymentMethodId:'master',installments:1,email:customer.email,identificationType:'CPF',identificationNumber:'12345678909'};

async function fixture(t,overrides={}){
 const config={...readConfig({}),frontendPath:resolve('frontend'),baseURL:'https://loja.example',publicKey:'TEST-public-key',webhookSecret:'test-webhook-secret',sellerId:'123',applicationId:'456',checkoutLimit:100,...overrides};
 const store=openStore(':memory:');t.after(()=>store.close());let gets=0,remote=null;
 const real=createGateway({accessToken:'test-access',sellerId:'123',applicationId:'456',baseURL:config.baseURL,mode:'test',fetchImpl:async()=>{throw Error('unexpected');}});
 const gateway={configured:true,cardConfigured:true,verifyCardPaymentIdentity:real.verifyCardPaymentIdentity,async createCardPayment(order){remote={id:'12345678901',external_reference:order.orderId,transaction_amount:order.total/100,currency_id:'BRL',collector_id:123,application_id:456,live_mode:false,status:'pending',status_detail:'pending_waiting_payment',date_created:new Date().toISOString(),date_last_updated:new Date().toISOString()};return structuredClone(remote);},async getPayment(){gets++;return structuredClone(remote);}};
 const shipping={configured:true,async quote(){return[];},get(_owner,id,cart,cep){assert.equal(id,'quote-1');assert.equal(cep,'01001000');return {quoteId:'quote-1',serviceCode:'SF-1',name:'PAC',priceCents:1191,days:6,cep:'01001000',cartHash:cart.hash,expiresAt:Date.now()+600000};}};
 const app=createApp({config,catalog,store,gateway,shipping,logger:{error(){}}});const agent=request.agent(app);const session=await agent.get('/api/session').expect(200),csrf=session.body.csrfToken;
 const post=(path,body,key=randomUUID())=>agent.post(path).set('Origin',config.baseURL).set('X-CSRF-Token',csrf).set('Idempotency-Key',key).send(body);
 const prepare=(body={items,customer,address,quoteId:'quote-1'},key=randomUUID())=>post('/api/card/prepare',body,key);
 return {app,agent,session,csrf,config,store,post,prepare,get gets(){return gets;},get remote(){return remote;},set remote(v){remote=v;}};
}

test('prepare persists authoritative total and stable customer identity',async t=>{const f=await fixture(t);const r=await f.prepare().expect(200);assert.equal(r.body.total,31191);assert.equal(r.body.customer.email,customer.email);assert.match(r.body.customer.customerId,/^[\da-f-]{36}$/i);assert.equal(f.store.listCustomers().length,1);});

test('client financial fields and malformed customer are rejected',async t=>{const f=await fixture(t);for(const extra of [{total:1},{price:1},{discount:1},{paymentStatus:'paid'}])await f.prepare({items,customer,address,quoteId:'quote-1',...extra}).expect(400);await f.prepare({items,address,customer:{...customer,email:'bad'},quoteId:'quote-1'}).expect(400);});

test('session, origin, csrf and idempotency remain required',async t=>{const f=await fixture(t),body={items,customer,address,quoteId:'quote-1'};await request(f.app).post('/api/card/prepare').send(body).expect(401);await f.agent.post('/api/card/prepare').send(body).expect(403);await f.agent.post('/api/card/prepare').set('Origin','https://attacker.example').send(body).expect(403);await f.agent.post('/api/card/prepare').set('Origin',f.config.baseURL).set('X-CSRF-Token',f.csrf).send(body).expect(400);});

test('private order is session-bound and success URL cannot mark paid',async t=>{const f=await fixture(t);const r=await f.prepare().expect(200),id=r.body.orderId;await request(f.app).get('/api/orders/'+id).expect(401);const other=request.agent(f.app);await other.get('/api/session');await other.get('/api/orders/'+id).expect(404);await f.agent.get('/sucesso?orderId='+id+'&status=approved').expect(200);assert.equal((await f.agent.get('/api/orders/'+id)).body.status,'pending');});

test('valid signed webhook reconciles payment and fulfillment once',async t=>{const f=await fixture(t);const prepared=await f.prepare().expect(200);await f.post('/api/card/pay',{orderId:prepared.body.orderId,card}).expect(200);f.remote={...f.remote,status:'approved',status_detail:'accredited',date_last_updated:new Date().toISOString()};const id='12345678901',requestId='request-id-12345',ts='1000000000',digest=createHmac('sha256',f.config.webhookSecret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');const body={application_id:456,user_id:123,live_mode:false,type:'payment',data:{id}};await request(f.app).post('/api/webhooks/mercadopago?data.id='+id+'&type=payment').set('x-request-id',requestId).set('x-signature',`ts=${ts},v1=${digest}`).send(body).expect(200);const order=f.store.get(prepared.body.orderId);assert.equal(order.status,'paid');assert.equal(order.fulfillmentStatus,'paid');assert.equal(f.store.db.prepare('SELECT count(*) n FROM outbox').get().n,1);});

test('live payments fail closed on non-durable deployment',async t=>{const f=await fixture(t,{mode:'production',durableStorage:false});assert.equal((await f.agent.get('/api/products').expect(200)).body.cardFormConfigured,false);await f.prepare().expect(503);});

test('SQLite persists session, customer and order across reopen',()=>{const dir=mkdtempSync(join(tmpdir(),'jewelry-test-'));try{const path=join(dir,'shop.sqlite');let s=openStore(path);const session=s.newSession(),cart=canonicalCart({items},catalog),key=randomUUID(),totals=calculate(cart.items,catalog);totals.customer=s.upsertCustomer(customer);const order=s.obtain(session.id,key,cart,totals,()=>({integration:'cardform'}));s.close();s=openStore(path);assert.equal(s.session(session.raw).id,session.id);assert.equal(s.get(order.orderId).customer.email,customer.email);assert.equal(s.listCustomers()[0].orders,1);s.close();}finally{rmSync(dir,{recursive:true,force:true});}});

test('real CardForm adapter uses payments API and idempotency',async()=>{const order={orderId:randomUUID(),items:[{name:'Test item',quantity:1,unitPrice:15000,subtotal:15000}],total:15000};const calls=[];const gateway=createGateway({accessToken:'test-only-token',sellerId:'123',applicationId:'456',baseURL:'https://loja.example',mode:'test',fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=>JSON.stringify({id:12345678901,external_reference:order.orderId,transaction_amount:150,currency_id:'BRL',collector_id:123,application_id:456,live_mode:false,status:'approved',status_detail:'accredited',date_created:new Date().toISOString()})};}});const key=randomUUID();await gateway.createCardPayment(order,card,key);assert.equal(calls[0].url,'https://api.mercadopago.com/v1/payments');assert.equal(calls[0].options.headers['X-Idempotency-Key'],key);});

test('configuration and exact money conversion remain strict',()=>{assert.throws(()=>readConfig({NODE_ENV:'production',APP_URL:'http://loja.example'}));assert.throws(()=>readConfig({TRUST_PROXY:'true'}));assert.equal(cents('199.90'),19990);assert.equal(money(19990),'199.90');});
