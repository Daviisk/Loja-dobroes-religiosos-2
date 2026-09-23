(()=>{
 'use strict';
 const load=src=>new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src=src;
  script.async=false;
  script.onload=resolve;
  script.onerror=()=>reject(new Error('Falha ao carregar '+src));
  document.head.append(script);
 });
 (async()=>{
  try{
   // Register the CardForm checkout handler before the legacy cart listener.
   // At the target phase, listeners run in registration order; loading the
   // payment handler first prevents the removed /api/checkout flow from firing.
   await load('/js/card-payment.js?v=cardform-hotfix-1');
   await load('/js/cart-core.js?v=cardform-hotfix-1');
  }catch(error){
   console.error(error);
   const message=document.querySelector('#cart-message');
   if(message){message.hidden=false;message.textContent='Não foi possível iniciar o checkout. Atualize a página e tente novamente.';}
  }
 })();
})();
