import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('página de acompanhamento usa link privado e linha do tempo',()=>{
  const html=read('frontend/sucesso.html');
  const js=read('frontend/js/order-status.js');
  assert.match(html,/id="order-progress"/);
  assert.match(html,/id="copy-tracking-link"/);
  assert.match(js,/\/api\/tracking-link\?orderId=/);
  assert.match(js,/\/api\/track\?orderId=/);
  assert.match(js,/Preparando pedido/);
  assert.match(js,/Pedido enviado/);
  assert.match(js,/Entregue/);
});

test('Vercel roteia acompanhamento e bundle do checkout antes da API genérica',()=>{
  const config=JSON.parse(read('vercel.json'));
  const routes=config.routes.map(route=>route.src||'');
  const trackingLink=routes.indexOf('/api/tracking-link');
  const tracking=routes.indexOf('/api/track');
  const generic=routes.indexOf('/api/(?<path>.*)');
  assert.ok(trackingLink>=0&&tracking>=0&&generic>=0);
  assert.ok(trackingLink<generic&&tracking<generic);
  assert.ok(routes.includes('/js/cart\\.js'));
});

test('checkout injeta acesso ao acompanhamento após cartão aprovado',()=>{
  const injector=read('frontend/js/tracking-link-injector.js');
  const bundle=read('api/cart-bundle.js');
  assert.match(injector,/jewelry\.pendingOrder/);
  assert.match(injector,/Acompanhar pedido/);
  assert.match(bundle,/tracking-link-injector\.js/);
});
