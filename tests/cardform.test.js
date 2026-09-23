import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {resolve} from 'node:path';
import request from 'supertest';
import {createApp} from '../backend/app.js';
import {openStore} from '../backend/store.js';
import {createGateway} from '../backend/services/mercadopago.js';
import {readConfig} from '../backend/config.js';

const catalog=[
 {productId:'produto_01',name:'Dobrão teste',priceCents:15000,enabled:true,maxQuantity:10},
 {productId:'produto_02',name:'Dobrão teste 2',priceCents:17000,enabled:true,maxQuantity:10}
];
const address={cep:'01001-000',street:'Praça da Sé',number:'1',complement:'',district:'Sé',city:'São Paulo',state:'SP'};
const customer={name:'Cliente Teste',phone:'11999999999',email:'buyer@example.com'};
const card={token:'test_card_token_1234567890',issuerId:'123',paymentMethodId:'master',installments:1,email:customer.email,identificationType:'CPF',identificationNumber:'12345678909'};

async function fixture(t,{paymentStatus='approved',paymentDetail='accredited',challenge=false,quoteExpiresAt=Date.now()+600000}={}){
 const config={...readConfig({}),frontendPath:resolve('frontend'),baseURL:'https://loja.example',publicKey:'TEST-public-key',webhookSecret:'test-webhook-secret',sellerId:'123',applicationId:'456',checkoutLimit:100};
 const store=openStore(':memory:');t.after(()=>store.close());
 const real=createGateway({accessToken:'test-access',sellerId:'123',applicationId:'456',baseURL:config.baseURL,mode:'test',fetchImpl:async()=>{throw Error('unexpected network');}});
 let latestRemote=null,createCalls=0,getCalls=0,lastKey='';
 const shipping={configured:true,async quote(){return[];},get(owner,id,cart,cep){assert.equal(id,'quote-1');assert.equal(cep,'01001000');return {quoteId:'quote-1',serviceCode:'SF-1',name:'SuperFrete · PAC',priceCents:1191,days:6,cep:'01001000',cartHash:cart.hash,expiresAt:quoteExpiresAt};}};
 const gateway={configured:true,cardConfigured:true,verifyCardPaymentIdentity:real.verifyCardPaymentIdentity,
  async createCardPayment(order,_card,key){createCalls++;lastKey=key;latestRemote={id:'12345678901',external_reference:order.orderId,transaction_amount:order.total/100,currency_id:'BRL',collector_id:123,application_id:456,live_mode:false,status:paymentStatus,status_detail:paymentDetail,date_created:new Date().toISOString(),date_last_updated:new Date().toISOString(),...(challenge?{three_ds_info:{external_resource_url:'https://acs.example/challenge',creq:'challenge-request-data'}}:{})};return structuredClone(latestRemote);},
  async getPayment(){getCalls++;return structuredClone(latestRemote);}};
 const app=createApp({config,catalog,store,gateway,shipping,logger:{error(){}}});
 const agent=request.agent(app);const session=await agent.get('/api/session').expect(200);const csrf=session.body.csrfToken;
 const prepare=(key=randomUUID(),extra={})=>agent.post('/api/card/prepare').set('Origin',config.baseURL).set('X-CSRF-Token',csrf).set('Idempotency-Key',key).send({items:[{productId:'produto_01',quantity:1}],customer,address,quoteId:'quote-1',...extra});
 const pay=(orderId,key=randomUUID(),bodyCard=card)=>agent.post('/api/card/pay').set('Origin',config.baseURL).set('X-CSRF-Token',csrf).set('Idempotency-Key',key).send({orderId,card:bodyCard});
 return {app,agent,config,store,gateway,csrf,prepare,pay,get createCalls(){return createCalls;},get getCalls(){return getCalls;},get latestRemote(){return latestRemote;},set latestRemote(v){latestRemote=v;},get lastKey(){return lastKey;}};
}

test('CardForm prepare returns server-authoritative products + shipping total',async t=>{
 const f=await fixture(t);const result=await f.prepare().expect(200);
 assert.equal(result.body.productsTotal,15000);assert.equal(result.body.shipping.priceCents,1191);assert.equal(result.body.total,16191);assert.equal(result.body.amount,'161.91');assert.equal(result.body.status,'pending');assert.equal(result.body.customer.email,customer.email);assert.match(result.body.orderId,/^[0-9a-f-]{36}$/i);assert.ok(result.body.quoteExpiresAt>Date.now());
 await f.prepare(randomUUID(),{amount:1}).expect(400);
});

test('CardForm approved payment uses stable idempotency key and server order amount',async t=>{
 const f=await fixture(t);const prepared=await f.prepare().expect(200);const paymentKey=randomUUID();const paid=await f.pay(prepared.body.orderId,paymentKey).expect(200);
 assert.equal(f.createCalls,1);assert.equal(f.lastKey,paymentKey);assert.equal(paid.body.status,'paid');assert.equal(paid.body.providerOrderId,'12345678901');assert.equal(paid.body.paymentId,'12345678901');assert.equal(f.store.db.prepare("SELECT count(*) n FROM outbox WHERE kind='order.paid'").get().n,1);
 const repeated=await f.pay(prepared.body.orderId,paymentKey).expect(200);assert.equal(repeated.body.status,'paid');assert.equal(f.createCalls,1);
});

test('approved payment with partially_refunded detail becomes partially_refunded and blocks fulfillment',async t=>{
 const f=await fixture(t);const prepared=await f.prepare().expect(200);await f.pay(prepared.body.orderId).expect(200);assert.equal(f.store.get(prepared.body.orderId).status,'paid');
 f.latestRemote={...f.latestRemote,status:'approved',status_detail:'partially_refunded',date_last_updated:new Date(Date.now()+1000).toISOString()};
 await f.agent.get('/api/orders/'+prepared.body.orderId).expect(200);const order=f.store.get(prepared.body.orderId);assert.equal(order.status,'partially_refunded');assert.equal(order.fulfillmentStatus,'hold');assert.equal(f.store.db.prepare('SELECT state FROM outbox WHERE order_id=?').get(order.orderId).state,'blocked');
});

test('CardForm exposes only validated 3DS challenge data and keeps order processing',async t=>{
 const f=await fixture(t,{paymentStatus:'pending',paymentDetail:'pending_challenge',challenge:true});const prepared=await f.prepare().expect(200);const response=await f.pay(prepared.body.orderId).expect(200);
 assert.equal(response.body.status,'processing');assert.equal(response.body.providerStatusDetail,'pending_challenge');assert.deepEqual(response.body.threeDs,{externalResourceUrl:'https://acs.example/challenge',creq:'challenge-request-data'});
});

test('retry with another browser key reconciles an existing provider payment instead of charging again',async t=>{
 const f=await fixture(t,{paymentStatus:'pending',paymentDetail:'pending_waiting_payment'});const prepared=await f.prepare().expect(200);const first=randomUUID();await f.pay(prepared.body.orderId,first).expect(200);await f.pay(prepared.body.orderId,randomUUID()).expect(200);assert.equal(f.createCalls,1);assert.equal(f.getCalls,1);
});

test('CardForm refuses to create a payment after the bound shipping quote expires',async t=>{
 const f=await fixture(t,{quoteExpiresAt:Date.now()-1});await f.prepare().expect(409);assert.equal(f.createCalls,0);
});

test('signed payment webhook reconciles CardForm payment through /v1/payments identity',async t=>{
 const f=await fixture(t,{paymentStatus:'approved',paymentDetail:'accredited'});const prepared=await f.prepare().expect(200);await f.pay(prepared.body.orderId).expect(200);
 const id='12345678901',requestId='request-id-12345',ts=String(Math.floor(Date.now()/1000));const digest=createHmac('sha256',f.config.webhookSecret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
 await request(f.app).post('/api/webhooks/mercadopago?data.id='+id+'&type=payment').set('x-request-id',requestId).set('x-signature',`ts=${ts},v1=${digest}`).send({id:999,application_id:456,user_id:123,live_mode:false,type:'payment',action:'payment.updated',data:{id}}).expect(200);
 assert.equal(f.store.get(prepared.body.orderId).status,'paid');assert.ok(f.getCalls>=1);
});

test('legacy order webhook topic is rejected in CardForm-only mode',async t=>{
 const f=await fixture(t);await request(f.app).post('/api/webhooks/mercadopago?data.id=ORDTST123456789012345678&type=order').set('x-request-id','request-id-12345').set('x-signature','ts=1000000000,v1=bad').send({type:'order',data:{id:'ORDTST123456789012345678'}}).expect(400);
});
