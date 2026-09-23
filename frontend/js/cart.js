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
   // O HTML de produção é servido em /frontend/ e carrega js/cart.js por caminho relativo.
   // Mantemos o carrinho/frete no arquivo core e removemos apenas o listener legado
   // que ainda chamava POST /api/checkout.
   await load('/frontend/js/cart-core.js?v=cardform-route-fix-1');
   const legacyButton=document.querySelector('#cart-checkout');
   if(!legacyButton)throw new Error('Botão de checkout não encontrado.');
   const cleanButton=legacyButton.cloneNode(true);
   legacyButton.replaceWith(cleanButton);

   // O fluxo atual usa Checkout Transparente/CardForm: /api/card/prepare e /api/card/pay.
   await load('/frontend/js/card-payment.js?v=cardform-route-fix-1');
   cleanButton.dataset.checkoutFlow='cardform';
  }catch(error){
   console.error(error);
   const message=document.querySelector('#cart-message');
   if(message){
    message.hidden=false;
    message.textContent='Não foi possível iniciar o checkout. Atualize a página e tente novamente.';
   }
  }
 })();
})();
