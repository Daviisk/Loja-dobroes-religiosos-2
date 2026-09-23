import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp} from '../backend/app.js';
import {openStore} from '../backend/store.js';
import {readConfig} from '../backend/config.js';
import {canonicalCart,calculate} from '../backend/validation.js';

const catalog=[{productId:'produto_01',name:'Dobrão teste',priceCents:15000,enabled:true,maxQuantity:10}];
const customer={name:'Cliente Teste',phone:'11999999999',email:'cliente@example.com'};

function fixture(t){
  const store=openStore(':memory:');t.after(()=>store.close());
  const config={...readConfig({}),frontendPath:resolve('frontend'),baseURL:'https://loja.example',adminPassword:'senha-administrativa-forte',adminSessionSecret:'segredo-administrativo-com-mais-de-trinta-e-dois-caracteres',adminConfigured:true};
  const cart=canonicalCart({items:[{productId:'produto_01',quantity:1}]},catalog),totals=calculate(cart.items,catalog),savedCustomer=store.upsertCustomer(customer),session=store.newSession();
  totals.customer=savedCustomer;totals.productsTotal=totals.total;totals.address={cep:'01001000',street:'Praça da Sé',number:'1',complement:'',district:'Sé',city:'São Paulo',state:'SP'};totals.shipping={name:'PAC',serviceCode:'SF-1',priceCents:1191,days:6,cep:'01001000'};totals.total+=1191;
  const order=store.obtain(session.id,randomUUID(),cart,totals,()=>({integration:'cardform'}));
  const app=createApp({config,catalog,store,gateway:{configured:false,cardConfigured:false},shipping:{configured:false},logger:{error(){}}});
  return {app,store,config,order};
}

test('admin APIs require authenticated signed session',async t=>{
  const f=fixture(t);await request(f.app).get('/api/admin/orders').expect(401);await request(f.app).post('/api/admin/login').set('Origin',f.config.baseURL).send({password:'errada'}).expect(401);
});

test('new orders use sequential friendly codes',t=>{
  const f=fixture(t);assert.match(f.order.orderCode,/^\d+$/);assert.ok(Number(f.order.orderCode)>=1001);assert.equal(f.order.fulfillmentHistory.length,1);assert.equal(f.order.fulfillmentHistory[0].to,'awaiting_payment');
});

test('admin lists customers, exposes metrics and cannot fulfill before confirmed payment',async t=>{
  const f=fixture(t),agent=request.agent(f.app);const login=await agent.post('/api/admin/login').set('Origin',f.config.baseURL).send({password:f.config.adminPassword}).expect(200);assert.match(login.headers['set-cookie'][0],/HttpOnly/);assert.match(login.headers['set-cookie'][0],/SameSite=Strict/);
  const orders=await agent.get('/api/admin/orders').expect(200);assert.equal(orders.body.orders.length,1);assert.equal(orders.body.orders[0].customer.email,customer.email);assert.equal(orders.body.orders[0].fulfillmentStatus,'awaiting_payment');assert.equal(orders.body.orders[0].fulfillmentHistory.length,1);assert.equal(orders.body.summary.total,1);assert.equal(orders.body.summary.awaitingPayment,1);assert.equal(orders.body.summary.awaitingShipment,0);assert.equal(orders.body.summary.revenuePaid,0);assert.equal(orders.body.summary.ticketAverage,0);
  const customers=await agent.get('/api/admin/customers').expect(200);assert.equal(customers.body.customers.length,1);assert.equal(customers.body.customers[0].orders,1);
  await agent.patch('/api/admin/orders/'+f.order.orderId).set('Origin',f.config.baseURL).send({fulfillmentStatus:'preparing',trackingCode:'',adminNotes:''}).expect(409);
  f.store.applySnapshot(f.order.orderId,{providerOrderId:'12345678901',paymentId:'12345678901',status:'paid',detail:'accredited',updatedAt:new Date().toISOString()});
  const paidOrders=await agent.get('/api/admin/orders').expect(200);assert.equal(paidOrders.body.summary.paid,1);assert.equal(paidOrders.body.summary.awaitingPayment,0);assert.equal(paidOrders.body.summary.awaitingShipment,1);assert.equal(paidOrders.body.summary.revenuePaid,16191);assert.equal(paidOrders.body.summary.ticketAverage,16191);assert.equal(paidOrders.body.orders[0].paymentProvider,'mercadopago');assert.equal(paidOrders.body.orders[0].fulfillmentHistory.at(-1).to,'paid');assert.equal(paidOrders.body.orders[0].fulfillmentHistory.at(-1).source,'payment');
  await agent.patch('/api/admin/orders/'+f.order.orderId).set('Origin',f.config.baseURL).send({fulfillmentStatus:'preparing',trackingCode:'BR123456789BR',adminNotes:'Separado para envio.'}).expect(200);
  const saved=f.store.get(f.order.orderId);assert.equal(saved.fulfillmentStatus,'preparing');assert.equal(saved.status,'paid');assert.equal(saved.trackingCode,'BR123456789BR');assert.equal(saved.fulfillmentHistory.at(-1).from,'paid');assert.equal(saved.fulfillmentHistory.at(-1).to,'preparing');assert.equal(saved.fulfillmentHistory.at(-1).source,'admin');
});

test('admin mutations reject foreign origins',async t=>{
  const f=fixture(t),agent=request.agent(f.app);await agent.post('/api/admin/login').set('Origin',f.config.baseURL).send({password:f.config.adminPassword}).expect(200);await agent.patch('/api/admin/orders/'+f.order.orderId).set('Origin','https://attacker.example').send({fulfillmentStatus:'shipped',trackingCode:'X',adminNotes:''}).expect(403);
});
