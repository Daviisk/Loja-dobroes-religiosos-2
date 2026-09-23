(()=>{
 'use strict';
 const get=s=>document.querySelector(s),cash=n=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const id=new URL(location.href).searchParams.get('orderId');let polls=0,timer,busy=false;
 const labels={pending:'Aguardando pagamento',processing:'Pagamento em processamento',paid:'Pagamento confirmado',cancelled:'Pedido cancelado',refunded:'Pagamento reembolsado',partially_refunded:'Pagamento parcialmente reembolsado',failed:'Pagamento não concluído',in_mediation:'Pagamento em mediação',charged_back:'Pagamento contestado/estornado'};
 async function update(){
  if(busy)return;busy=true;get('#refresh-order').disabled=true;clearTimeout(timer);
  try{
   if(!id||!/^[0-9a-f-]{36}$/i.test(id))throw Error('Nenhum pedido válido foi informado. Acessar esta página não confirma um pagamento.');
   const response=await fetch('/api/orders/'+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});const order=await response.json();if(!response.ok)throw Error(order.message||'Pedido não encontrado nesta sessão.');
   get('#order-status').textContent=labels[order.status]||'Conferência pendente';get('#order-reference').textContent=`Pedido da loja: ${order.orderId}`;get('#provider-order-reference').textContent=order.providerOrderId?`Pagamento Mercado Pago: ${order.providerOrderId}`:'Pagamento Mercado Pago: aguardando registro';get('#order-total').textContent=cash(order.total);get('#order-items').replaceChildren(...order.items.map(item=>{const li=document.createElement('li');li.textContent=`${item.quantity} × ${item.name} — ${cash(item.subtotal)}`;return li;}));
   get('#order-message').textContent=order.status==='paid'?'O pagamento foi confirmado pelo servidor.':order.status==='in_mediation'?'O pagamento está em mediação. Não realize uma nova cobrança para este pedido.':order.status==='charged_back'?'O pagamento foi contestado/estornado pelo emissor.':order.status==='pending'||order.status==='processing'?'Aguardando a confirmação do Mercado Pago. Você pode atualizar o acompanhamento.':'Confira o status acima. Entre em contato com a loja se precisar de ajuda.';
   if(order.status==='paid'){
    try{if(sessionStorage.getItem('jewelry.pendingOrder')===order.orderId){const model=window.JewelryCartModel,items=model.clean(localStorage.getItem(model.KEY));const expected=order.items.map(({productId,quantity})=>({productId,quantity})).sort((a,b)=>a.productId.localeCompare(b.productId));if(JSON.stringify(items)===JSON.stringify(expected))localStorage.setItem(model.KEY,JSON.stringify({items:[]}));sessionStorage.removeItem('jewelry.pendingOrder');sessionStorage.removeItem('jewelry.paymentAttempt.'+order.orderId);sessionStorage.removeItem('jewelry.cardPrepare');}}catch{}
   }else if(['pending','processing','in_mediation'].includes(order.status)&&polls++<60){timer=setTimeout(update,5000);}
  }catch(e){get('#order-status').textContent='Pagamento não confirmado';get('#order-message').textContent=e.message;}
  finally{busy=false;get('#refresh-order').disabled=false;}
 }
 get('#refresh-order').addEventListener('click',update);update();
})();
