import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {openStore} from '../backend/store.js';
import {createApp} from '../backend/app.js';
import {readConfig} from '../backend/config.js';
import {products} from '../backend/products.js';
import {createShipping,createCorreios,createSuperfrete,addressInput} from '../backend/services/shipping.js';
const items=[{productId:'produto_01',quantity:2}];
const address={cep:'01001000',street:'Praça da Sé',number:'1',complement:'',district:'Sé',city:'São Paulo',state:'SP'};
const customer={name:'Cliente Teste',phone:'11999999999',email:'buyer@example.com'};
async function fixture(t){
 const store=openStore(':memory:');t.after(()=>store.close());const provider={configured:true,async quote(){return [{name:'Correios PAC',serviceCode:'03298',priceCents:2345,days:4}];}};
 const shipping=createShipping(store,provider),config={...readConfig({}),baseURL:'https://loja.example',frontendPath:resolve('frontend'),publicKey:'TEST-public-key',webhookSecret:'test-only-secret'};
 const gateway={configured:true,cardConfigured:true};
 const app=createApp({config,catalog:products,store,gateway,shipping,logger:{error(){}}}),agent=request.agent(app);const session=await agent.get('/api/session');
 const post=(path,body,key=randomUUID())=>agent.post(path).set('Origin',config.baseURL).set('X-CSRF-Token',session.body.csrfToken).set('Idempotency-Key',key).send(body);
 const quote=async()=>{const r=await post('/api/shipping/quote',{items,cep:address.cep}).expect(200);return r.body.options[0];};
 return {app,agent,post,quote,store,shipping,provider};
}
test('five saints cost exactly R$150 each',()=>{assert.equal(products.length,5);assert(products.every(p=>p.priceCents===15000));});
test('server shipping is included in prepared CardForm order and duplicate request reuses order',async t=>{
 const f=await fixture(t),q=await f.quote(),body={items,customer,address,quoteId:q.quoteId},key=randomUUID();
 const a=await f.post('/api/card/prepare',body,key).expect(200);const b=await f.post('/api/card/prepare',body,key).expect(200);
 assert.equal(a.body.total,32345);assert.equal(a.body.productsTotal,30000);assert.equal(a.body.shipping.priceCents,2345);assert.equal(a.body.amount,'323.45');assert.equal(b.body.orderId,a.body.orderId);assert.equal(a.body.customer.email,customer.email);
 const order=f.store.get(a.body.orderId);assert.deepEqual(order.address,address);assert.equal(order.gatewayPayload.integration,'payments-api');assert.equal(order.total,32345);
 const q2=await f.quote();const c=await f.post('/api/card/prepare',{...body,quoteId:q2.quoteId}).expect(200);assert.notEqual(c.body.orderId,a.body.orderId);
});
test('changing address with same request key conflicts, fresh key creates separate delivery',async t=>{
 const f=await fixture(t),q=await f.quote(),body={items,customer,address,quoteId:q.quoteId},key=randomUUID();await f.post('/api/card/prepare',body,key).expect(200);
 await f.post('/api/card/prepare',{...body,address:{...address,number:'2'}},key).expect(409);
 const r=await f.post('/api/card/prepare',{...body,address:{...address,number:'2'}}).expect(200);assert.equal(r.body.address.number,'2');
});
test('unconfigured shipping fails closed; client financial fields are rejected',async t=>{
 const f=await fixture(t),q=await f.quote(),body={items,customer,address,quoteId:q.quoteId};
 for(const extra of [{total:1},{shipping:0},{price:1},{paymentStatus:'paid'}])await f.post('/api/card/prepare',{...body,...extra}).expect(400);
 await f.post('/api/card/prepare',{items}).expect(400);
 const off=createShipping(f.store,createCorreios({}));await assert.rejects(off.quote('owner',{items,hash:'x'},address.cep),e=>e.code==='shipping_not_configured');
});
test('CEP, cart, owner, expiry and quote ID cannot be substituted',async t=>{
 const f=await fixture(t),q=await f.quote(),body={items,customer,address,quoteId:q.quoteId};
 await f.post('/api/card/prepare',{...body,quoteId:randomUUID()}).expect(409);
 await f.post('/api/card/prepare',{...body,address:{...address,cep:'20040020'}}).expect(409);
 await f.post('/api/card/prepare',{...body,items:[{productId:'produto_01',quantity:1}]}).expect(409);
 await assert.rejects(f.shipping.get('other',q.quoteId,{hash:'x'},address.cep),e=>e.code==='shipping_quote_required');
 f.store.db.prepare('UPDATE shipping_quotes SET expires=0').run();await f.post('/api/card/prepare',body).expect(409);
});
test('address validation rejects missing fields, invalid UF and markup',()=>{
 for(const change of [{state:'XX'},{cep:'0'},{street:'<script>x</script>'},{number:''},{country:'US'}])assert.throws(()=>addressInput({...address,...change}));
 assert.equal(addressInput({...address,cep:'01001-000',number:'S/N'}).cep,'01001000');
});
test('shipping request rejects malformed payload, invalid CEP, spoofed prices and rate flood',async t=>{
 const f=await fixture(t);
 for(const body of [{items,cep:'abc'},{items,cep:'00000000'},{items:[],cep:'01001000'},{items,cep:'01001000',price:1}])await f.post('/api/shipping/quote',body).expect(400);
 for(let i=0;i<11;i++)await f.post('/api/shipping/quote',{items:[],cep:'01001000'}).expect(400);
 await f.post('/api/shipping/quote',{items,cep:'01001000'}).expect(429);
});
test('Correios adapter obtains private token, server weight/dimensions, price and delivery estimate',async()=>{
 const calls=[];const env={CORREIOS_MODE:'homologation',CORREIOS_USER:'test',CORREIOS_API_PASSWORD:'test',CORREIOS_POSTING_CARD:'test',SHIPPING_ORIGIN_CEP:'74000000',CORREIOS_PAC_CODE:'03298',SHIPPING_UNIT_WEIGHT_G:'50',SHIPPING_PACKAGE_WEIGHT_G:'100',SHIPPING_LENGTH_CM:'20',SHIPPING_WIDTH_CM:'15',SHIPPING_BASE_HEIGHT_CM:'2',SHIPPING_UNIT_HEIGHT_CM:'1'};
 const provider=createCorreios(env,async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('/token/')?{token:'test-token'}:url.includes('/preco/')?{coProduto:'03298',pcFinal:'23,45'}:{coProduto:'03298',prazoEntrega:4}};});
 const q=await provider.quote(items,'01001000');assert.equal(q[0].priceCents,2345);assert.equal(calls.length,3);assert.match(calls.find(c=>c.url.includes('/preco/')).url,/psObjeto=200/);assert.match(calls.find(c=>c.url.includes('/preco/')).url,/altura=4/);assert.equal(calls[1].options.headers.Authorization,'Bearer test-token');
});
test('SuperFrete adapter keeps token private and calculates price from server dimensions',async()=>{
 const calls=[];const env={SUPERFRETE_TOKEN:'test-token',SHIPPING_ORIGIN_CEP:'74000000',SHIPPING_UNIT_WEIGHT_G:'50',SHIPPING_PACKAGE_WEIGHT_G:'100',SHIPPING_LENGTH_CM:'20',SHIPPING_WIDTH_CM:'15',SHIPPING_BASE_HEIGHT_CM:'2',SHIPPING_UNIT_HEIGHT_CM:'1'};
 const provider=createSuperfrete(env,async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>[{id:1,name:'PAC',price:'23.45',delivery_time:4,company:{name:'Correios'}}]};});
 const q=await provider.quote(items,'01001000');assert.deepEqual(q,[{serviceCode:'SF-1',name:'SuperFrete · Correios PAC',priceCents:2345,days:4}]);assert.equal(calls.length,1);assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');const body=JSON.parse(calls[0].options.body);assert.equal(body.package.weight,.2);assert.equal(body.package.height,4);
});
