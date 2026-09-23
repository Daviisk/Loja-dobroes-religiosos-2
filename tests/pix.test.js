import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import request from 'supertest';
import {createApp} from '../backend/app.js';
import {openStore} from '../backend/store.js';
import {readConfig} from '../backend/config.js';

const catalog=[{productId:'produto_01',name:'Produto teste',priceCents:15000,enabled:true,maxQuantity:10}];
const address={cep:'01001-000',street:'Praça da Sé',number:'1',complement:'',district:'Sé',city:'São Paulo',state:'SP'};
const customer={name:'Cliente Teste',phone:'11999999999',email:'buyer@example.com'};
const identification={identificationType:'CPF',identificationNumber:'11111111111'};

async function fixture(t){
 const config={...readConfig({}),frontendPath:resolve('frontend'),baseURL:'https://loja.example',mode:'test',webhookSecret:'test-webhook-secret',sellerId:'123',applicationId:'456',checkoutLimit:100};
 const store=openStore(':memory:');t.after(()=>store.close());let createCalls=0,getCalls=0,lastKey='',latestRemote=null;
 const shipping={configured:true,async quote(){return[];},get(_owner,id,cart,cep){assert.equal(id,'quote-1');assert.equal(cep,'01001000');return {quoteId:'quote-1',serviceCode:'SF-1',name:'Frete teste',priceCents:1191,days:6,cep:'01001000',cartHash:cart.hash,expiresAt:Date.now()+600000};}};
 const verify=(remote,order)=>{assert.equal(remote.external_reference,order.orderId);assert.equal(Math.round(Number(remote.transaction_amount)*100),order.total);};
 const gateway={configured:true,cardConfigured:false,pixConfigured:true,verifyPaymentIdentity:verify,verifyCardPaymentIdentity:verify,
  async createPixPayment(order,payer,key){createCalls++;lastKey=key;assert.deepEqual(payer,identification);latestRemote={id:'12345678901',external_reference:order.orderId,transaction_amount:order.total/100,currency_id:'BRL',collector_id:123,application_id:456,live_mode:false,payment_method_id:'pix',status:'pending',status_detail:'pending_waiting_transfer',date_created:new Date().toISOString(),date_last_updated:new Date().toISOString(),date_of_expiration:new Date(Date.now()+1800000).toISOString(),point_of_interaction:{type:'PIX',transaction_data:{qr_code_base64:'aGVsbG8=',qr_code:'000201PIXTEST123456',ticket_url:'https://www.mercadopago.com.br/payments/123/ticket'}}};return structuredClone(latestRemote);},async getPayment(){getCalls++;return structuredClone(latestRemote);}};
 const app=createApp({config,catalog,store,gateway,shipping,logger:{error(){}}}),agent=request.agent(app),session=await agent.get('/api/session').expect(200),csrf=session.body.csrfToken;
 const prepare=(key=randomUUID())=>agent.post('/api/pix/prepare').set('Origin',config.baseURL).set('X-CSRF-Token',csrf).set('Idempotency-Key',key).send({items:[{productId:'produto_01',quantity:1}],customer,address,quoteId:'quote-1'});
 const pay=(orderId,key=randomUUID(),doc=identification)=>agent.post('/api/pix/pay').set('Origin',config.baseURL).set('X-CSRF-Token',csrf).set('Idempotency-Key',key).send({orderId,identification:doc});
 return {agent,prepare,pay,get createCalls(){return createCalls;},get getCalls(){return getCalls;},get lastKey(){return lastKey;},get latestRemote(){return latestRemote;},set latestRemote(v){latestRemote=v;}};
}

test('Pix appears as an available checkout method',async t=>{const f=await fixture(t),r=await f.agent.get('/api/products').expect(200);assert.equal(r.body.pixConfigured,true);assert.deepEqual(r.body.paymentMethods,['pix']);});

test('Pix returns QR Code and preserves idempotency',async t=>{const f=await fixture(t),prepared=await f.prepare().expect(200),key=randomUUID(),r=await f.pay(prepared.body.orderId,key).expect(200);assert.equal(r.body.status,'processing');assert.equal(r.body.paymentMethod,'pix');assert.equal(r.body.pix.qrCode,'000201PIXTEST123456');assert.equal(f.createCalls,1);await f.pay(prepared.body.orderId,key).expect(200);assert.equal(f.createCalls,1);assert.equal(f.getCalls,1);});

test('Pix rejects malformed document',async t=>{const f=await fixture(t),prepared=await f.prepare().expect(200);await f.pay(prepared.body.orderId,randomUUID(),{identificationType:'CPF',identificationNumber:'123'}).expect(400);assert.equal(f.createCalls,0);});

test('Pix pending payment reconciles to paid',async t=>{const f=await fixture(t),prepared=await f.prepare().expect(200);await f.pay(prepared.body.orderId).expect(200);f.latestRemote={...f.latestRemote,status:'approved',status_detail:'accredited',date_last_updated:new Date(Date.now()+1000).toISOString()};const r=await f.agent.get('/api/orders/'+prepared.body.orderId).expect(200);assert.equal(r.body.status,'paid');assert.equal(r.body.paymentMethod,'pix');});
