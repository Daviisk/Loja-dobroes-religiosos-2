(()=>{
 'use strict';
 function pendingOrderId(){try{return sessionStorage.getItem('jewelry.pendingOrder')||'';}catch{return '';}}
 function inject(){
  const result=document.querySelector('.card-payment-result.success');
  if(!result||result.querySelector('[data-order-tracking-link]'))return;
  const orderId=pendingOrderId();if(!/^[0-9a-f-]{36}$/i.test(orderId))return;
  const link=document.createElement('a');link.className='button';link.dataset.orderTrackingLink='true';link.href='/sucesso?orderId='+encodeURIComponent(orderId);link.textContent='Acompanhar pedido';
  const finish=result.querySelector('#card-payment-finish');if(finish)finish.before(link);else result.append(link);
 }
 const observer=new MutationObserver(inject);observer.observe(document.documentElement,{subtree:true,childList:true});inject();
})();
