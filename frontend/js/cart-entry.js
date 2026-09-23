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
   // Load the cart UI first so freight, totals and cart state keep working.
   await load('/js/cart-core.js?v=cardform-hotfix-2');

   // cart-core still contains the removed Checkout Pro click handler that calls
   // POST /api/checkout. Replacing only the button removes that anonymous legacy
   // listener while preserving the element id, classes, attributes and state.
   const legacyButton=document.querySelector('#cart-checkout');
   if(!legacyButton)throw new Error('Botão de checkout não encontrado.');
   const cleanButton=legacyButton.cloneNode(true);
   legacyButton.replaceWith(cleanButton);

   // Attach the current Mercado Pago CardForm flow to the clean button.
   await load('/js/card-payment.js?v=cardform-hotfix-2');
   cleanButton.dataset.checkoutFlow='cardform';
  }catch(error){
   console.error(error);
   const message=document.querySelector('#cart-message');
   if(message){message.hidden=false;message.textContent='Não foi possível iniciar o checkout. Atualize a página e tente novamente.';}
  }
 })();
})();
