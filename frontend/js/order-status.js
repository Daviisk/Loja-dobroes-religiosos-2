(()=>{
 'use strict';
 const get=s=>document.querySelector(s),cash=n=>(Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),date=v=>v?new Date(v).toLocaleString('pt-BR'):'—';
 const id=new URL(location.href).searchParams.get('orderId');let polls=0,timer,busy=false;
 const labels={pending:'Aguardando pagamento',processing:'Pagamento em processamento',paid:'Pagamento confirmado',cancelled:'Pedido cancelado',refunded:'Pagamento reembolsado',partially_refunded:'Pagamento parcialmente reembolsado',failed:'Pagamento não concluído',in_mediation:'Pagamento em mediação',charged_back:'Pagamento contestado/estornado'};
 function addressText(a={}){return [a.street&&`${a.street}, ${a.number||'s/n'}${a.complement?' · '+a.complement:''}`,a.district&&`${a.district} · ${a.city||''}/${a.state||''}`,a.cep&&`CEP ${a.cep}`].filter(Boolean).join(' — ')||'Endereço não disponível.';}
 function renderProgress(order){
  const rank={awaiting_payment:0,paid:1,preparing:2,shipped:3,delivered:4},current=rank[order.fulfillmentStatus]??0,history=Array.isArray(order.fulfillmentHistory)?order.fulfillmentHistory:[],stages=[['Pedido criado','awaiting_payment'],['Pagamento','paid'],['Preparação','preparing'],['Enviado','shipped'],['Entregue','delivered']];
  const historyDate=status=>history.findLast?.(item=>item?.to===status)?.at||[...history].reverse().find(item=>item?.to===status)?.at||'';
  const list=get('#order-progress');list.replaceChildren(...stages.map(([name,status],index)=>{const li=document.createElement('li');li.className=index<current?'done':index===current?'current':'';const dot=document.createElement('span');dot.className='step-dot';dot.textContent=String(index+1);const strong=document.createElement('strong');strong.textContent=name;li.append(dot,strong);const when=historyDate(status)||(status==='awaiting_payment'?order.createdAt:'');if(when){const small=document.createElement('small');small.textContent=date(when);li.append(small);}return li;}));
  const warning=get('#order-progress-warning');if(order.fulfillmentStatus==='hold'){warning.hidden=false;warning.textContent='Este pedido está em análise financeira. A expedição fica pausada até a situação ser resolvida.';}else if(order.fulfillmentStatus==='cancelled'){warning.hidden=false;warning.textContent='Este pedido foi cancelado e não seguirá para expedição.';}else{warning.hidden=true;warning.textContent='';}
 }
 async function update(){
  if(busy)return;busy=true;get('#refresh-order').disabled=true;clearTimeout(timer);
  try{
   if(!id||!/^[0-9a-f-]{36}$/i.test(id))throw Error('Nenhum pedido válido foi informado. Acessar esta página não confirma um pagamento.');
   const response=await fetch('/api/orders/'+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});const order=await response.json();if(!response.ok)throw Error(order.message||'Pedido não encontrado nesta sessão.');
   const shipping=order.shipping||{};renderProgress(order);
   get('#order-status').textContent=labels[order.status]||'Conferência pendente';get('#order-reference').textContent=`Pedido #${order.orderCode||order.orderId}`;get('#provider-order-reference').textContent=order.providerOrderId?`Pagamento Mercado Pago: ${order.providerOrderId}`:'Pagamento Mercado Pago: aguardando registro';get('#order-products-total').textContent=cash(order.productsTotal);get('#order-shipping-total').textContent=cash(shipping.priceCents);get('#order-total').textContent=cash(order.total);get('#order-items').replaceChildren(...order.items.map(item=>{const li=document.createElement('li');li.textContent=`${item.quantity} × ${item.name} — ${cash(item.subtotal)}`;return li;}));
   get('#order-address').textContent=addressText(order.address);get('#order-shipping').textContent=shipping.name?`${shipping.name} · prazo estimado de ${shipping.days||'—'} dia(s) útil(eis) após postagem`:'Modalidade de entrega não disponível.';
   const tracking=get('#order-tracking');if(order.trackingCode){tracking.hidden=false;tracking.textContent=`Código de rastreio: ${order.trackingCode}`;}else{tracking.hidden=true;tracking.textContent='';}
   get('#order-message').textContent=order.status==='paid'?'O pagamento foi confirmado pelo servidor.':order.status==='in_mediation'?'O pagamento está em mediação. Não realize uma nova cobrança para este pedido.':order.status==='charged_back'?'O pagamento foi contestado/estornado pelo emissor.':order.status==='pending'||order.status==='processing'?'Aguardando a confirmação do Mercado Pago. Você pode atualizar o acompanhamento.':'Confira o status acima. Entre em contato com a loja se precisar de ajuda.';
   if(order.status==='paid'){
    try{if(sessionStorage.getItem('jewelry.pendingOrder')===order.orderId){const model=window.JewelryCartModel,items=model.clean(localStorage.getItem(model.KEY));const expected=order.items.map(({productId,quantity})=>({productId,quantity})).sort((a,b)=>a.productId.localeCompare(b.productId));if(JSON.stringify(items)===JSON.stringify(expected))localStorage.setItem(model.KEY,JSON.stringify({items:[]}));sessionStorage.removeItem('jewelry.pendingOrder');sessionStorage.removeItem('jewelry.paymentAttempt.'+order.orderId);sessionStorage.removeItem('jewelry.cardPrepare');}}catch{}
   }else if(['pending','processing','in_mediation'].includes(order.status)&&polls++<60){timer=setTimeout(update,5000);}
  }catch(e){get('#order-status').textContent='Pagamento não confirmado';get('#order-message').textContent=e.message;}
  finally{busy=false;get('#refresh-order').disabled=false;}
 }
 get('#refresh-order').addEventListener('click',update);update();
})();
