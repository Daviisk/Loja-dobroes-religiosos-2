(()=>{
 'use strict';
 const get=s=>document.querySelector(s);
 const checkoutButton=get('#cart-checkout');
 if(!checkoutButton||!window.JewelryCartModel)return;

 const css=document.createElement('link');css.rel='stylesheet';css.href='/css/card-payment.css';document.head.append(css);

 let flowBusy=false,cardForm=null,mp=null,attemptKey=null,context=null,sdkPromise=null,polling=false;
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const setMessage=text=>{const el=get('#card-payment-message');if(el){el.textContent=text;el.hidden=!text;}};
 const cash=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

 async function api(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,signal:AbortSignal.timeout(20000)});
  let data=null;try{data=await response.json();}catch{}
  if(!response.ok){const error=new Error(data?.message||'Não foi possível concluir a operação.');error.code=data?.error||'request_failed';throw error;}
  return data;
 }

 function cartItems(){
  let storage;try{storage=localStorage;}catch{storage={getItem(){return null;},setItem(){}};}
  return new window.JewelryCartModel.Cart(storage).payload().items;
 }
 function addressData(){return Object.fromEntries([...new FormData(get('#delivery-form'))].filter(([key])=>key!=='shipping-choice'));}
 function storageGet(key){try{return sessionStorage.getItem(key)||'';}catch{return '';}}
 function storageSet(key,value){try{sessionStorage.setItem(key,value);}catch{}}
 function storageRemove(key){try{sessionStorage.removeItem(key);}catch{}}
 function paymentAttemptStorageKey(orderId){return 'jewelry.paymentAttempt.'+orderId;}

 function loadSdk(){
  if(window.MercadoPago)return Promise.resolve();
  if(sdkPromise)return sdkPromise;
  sdkPromise=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='https://sdk.mercadopago.com/js/v2';script.async=true;script.onload=resolve;script.onerror=()=>reject(new Error('Não foi possível carregar o pagamento seguro do Mercado Pago.'));document.head.append(script);
  });
  return sdkPromise;
 }

 function clearAttemptState(orderId){
  if(orderId)storageRemove(paymentAttemptStorageKey(orderId));
  storageRemove('jewelry.cardPrepare');
 }

 function resetPanel(){
  try{cardForm?.unmount?.();}catch{}
  cardForm=null;mp=null;attemptKey=null;context=null;polling=false;
  const review=get('#cart-review'),filled=get('#cart-filled');if(review)review.hidden=true;if(filled)filled.hidden=false;
 }

 function showPanel(){
  const review=get('#cart-review'),filled=get('#cart-filled');filled.hidden=true;review.hidden=false;
  review.innerHTML=`
    <div class="card-payment-head"><div><span class="card-payment-kicker">Pagamento seguro</span><h3>Cartão de crédito</h3></div><button type="button" id="card-payment-back" class="card-payment-back" aria-label="Voltar ao carrinho">←</button></div>
    <ul id="checkout-review-items" class="card-payment-summary"></ul>
    <p class="card-payment-total">Total confirmado pelo servidor <strong id="checkout-review-total"></strong></p>
    <form id="form-checkout" class="mp-card-form" novalidate>
      <label>Número do cartão<div id="form-checkout__cardNumber" class="mp-secure-field"></div></label>
      <div class="mp-card-grid"><label>Validade<div id="form-checkout__expirationDate" class="mp-secure-field"></div></label><label>CVV<div id="form-checkout__securityCode" class="mp-secure-field"></div></label></div>
      <label>Nome no cartão<input type="text" id="form-checkout__cardholderName" autocomplete="cc-name" placeholder="Como está no cartão"></label>
      <div class="mp-card-grid"><label>Emissor<select id="form-checkout__issuer"></select></label><label>Parcelas<select id="form-checkout__installments"></select></label></div>
      <div class="mp-card-grid"><label>Documento<select id="form-checkout__identificationType"></select></label><label>Número do documento<input type="text" id="form-checkout__identificationNumber" inputmode="numeric" autocomplete="off"></label></div>
      <label>E-mail<input type="email" id="form-checkout__cardholderEmail" autocomplete="email" placeholder="seu@email.com"></label>
      <button type="submit" id="form-checkout__submit" class="button card-payment-submit">Pagar com cartão</button>
      <progress id="card-payment-progress" value="0" class="card-payment-progress">Carregando…</progress>
    </form>
    <p id="card-payment-message" class="card-payment-message" role="status" hidden></p>
    <p class="card-payment-security">Número do cartão, validade e CVV são enviados diretamente ao Mercado Pago e não passam pelo servidor da loja.</p>`;

  const list=get('#checkout-review-items');
  for(const item of context.prepared.items||[]){const li=document.createElement('li');li.textContent=`${item.quantity} × ${item.name} — ${cash(item.subtotal)}`;list.append(li);}
  if(context.prepared.shipping){const li=document.createElement('li');li.textContent=`${context.prepared.shipping.name} — ${cash(context.prepared.shipping.priceCents)}`;list.append(li);}
  get('#checkout-review-total').textContent=cash(context.prepared.total);
  get('#card-payment-back').addEventListener('click',resetPanel);
 }

 async function initializeCardForm(publicKey){
  await loadSdk();
  mp=new window.MercadoPago(publicKey,{locale:'pt-BR'});
  cardForm=mp.cardForm({
   amount:context.prepared.amount,iframe:true,autoMount:true,
   form:{
    id:'form-checkout',
    cardNumber:{id:'form-checkout__cardNumber',placeholder:'Número do cartão'},
    expirationDate:{id:'form-checkout__expirationDate',placeholder:'MM/AA'},
    securityCode:{id:'form-checkout__securityCode',placeholder:'CVV'},
    cardholderName:{id:'form-checkout__cardholderName',placeholder:'Nome no cartão'},
    issuer:{id:'form-checkout__issuer',placeholder:'Banco emissor'},
    installments:{id:'form-checkout__installments',placeholder:'Parcelas'},
    identificationType:{id:'form-checkout__identificationType',placeholder:'Tipo'},
    identificationNumber:{id:'form-checkout__identificationNumber',placeholder:'Documento'},
    cardholderEmail:{id:'form-checkout__cardholderEmail',placeholder:'E-mail'}
   },
   callbacks:{
    onFormMounted:error=>{if(error)setMessage('Não foi possível iniciar o formulário do cartão. Atualize a página e tente novamente.');},
    onSubmit:event=>{event.preventDefault();submitCardPayment();},
    onFetching:()=>{const bar=get('#card-payment-progress');bar?.removeAttribute('value');return()=>bar?.setAttribute('value','0');}
   }
  });
 }

 function normalizeCardData(data){
  return {
   token:String(data.token||''),
   issuerId:String(data.issuerId??data.issuer_id??''),
   paymentMethodId:String(data.paymentMethodId??data.payment_method_id??''),
   installments:Number(data.installments),
   email:String(data.cardholderEmail??data.email??''),
   identificationType:String(data.identificationType??data.identification_type??''),
   identificationNumber:String(data.identificationNumber??data.identification_number??'')
  };
 }

 function clearCartAfterPayment(){
  try{localStorage.removeItem(window.JewelryCartModel.KEY);}catch{}
  const count=get('#cart-count');if(count)count.textContent='0';
 }

 function showPaid(result){
  clearCartAfterPayment();clearAttemptState(result.orderId);
  const review=get('#cart-review');review.innerHTML=`<div class="card-payment-result success"><span class="card-payment-result-icon">✓</span><h3>Pagamento aprovado</h3><p>Seu pagamento foi confirmado pelo Mercado Pago.</p><p class="order-reference">Pedido ${result.orderId}</p><p class="order-reference">Pagamento ${result.paymentId||result.providerOrderId||''}</p><button type="button" id="card-payment-finish" class="button">Continuar na loja</button></div>`;
  get('#card-payment-finish').addEventListener('click',()=>location.reload());
 }

 function showTerminal(result){
  clearAttemptState(result?.orderId||context?.prepared?.orderId);
  const status=result?.status;
  const text=status==='charged_back'?'O pagamento foi contestado/estornado pelo emissor.':status==='refunded'?'O pagamento foi reembolsado.':status==='cancelled'?'O pagamento foi cancelado.':result?.providerStatusDetail?`Pagamento não aprovado (${result.providerStatusDetail}).`:'Pagamento não aprovado.';
  const review=get('#cart-review');review.innerHTML=`<div class="card-payment-result"><span class="card-payment-result-icon">!</span><h3>Pagamento não concluído</h3><p>${text}</p><button type="button" id="card-payment-return" class="button">Voltar ao carrinho</button></div>`;
  get('#card-payment-return').addEventListener('click',resetPanel);
 }

 function showMediation(result){
  setMessage('O pagamento entrou em mediação. Não faça uma nova cobrança para este pedido enquanto a análise estiver em andamento.');
  const submit=get('#form-checkout__submit');if(submit)submit.disabled=true;
 }

 function showChallenge(result){
  const info=result?.threeDs;
  if(!info?.externalResourceUrl||!info?.creq){setMessage('O banco solicitou autenticação adicional, mas não foi possível abrir o desafio. Aguarde a atualização do pagamento.');pollOrder(result.orderId);return;}
  let url;try{url=new URL(info.externalResourceUrl);if(url.protocol!=='https:')throw Error();}catch{setMessage('O endereço de autenticação do banco é inválido. Aguarde a atualização do pagamento.');pollOrder(result.orderId);return;}
  try{cardForm?.unmount?.();}catch{}cardForm=null;
  const form=get('#form-checkout');if(form)form.hidden=true;
  const review=get('#cart-review');
  const wrap=document.createElement('section');wrap.className='three-ds-wrap';
  const title=document.createElement('h3');title.textContent='Confirme a compra com seu banco';
  const note=document.createElement('p');note.textContent='Conclua a autenticação abaixo. Não feche nem atualize esta página durante a confirmação.';
  const frame=document.createElement('iframe');frame.name='three-ds-frame';frame.id='three-ds-frame';frame.className='three-ds-frame';frame.title='Autenticação 3D Secure do banco';
  wrap.append(title,note,frame);review.append(wrap);
  const challengeForm=document.createElement('form');challengeForm.method='POST';challengeForm.action=url.toString();challengeForm.target=frame.name;challengeForm.hidden=true;
  const creq=document.createElement('input');creq.type='hidden';creq.name='creq';creq.value=info.creq;challengeForm.append(creq);document.body.append(challengeForm);challengeForm.submit();challengeForm.remove();
  setMessage('Aguardando a confirmação do banco…');pollOrder(result.orderId);
 }

 async function pollOrder(orderId){
  if(polling)return;polling=true;
  try{
   for(let i=0;i<100;i++){
    await sleep(3000);
    try{
     const order=await api('/api/orders/'+encodeURIComponent(orderId));
     if(order.status==='paid'){showPaid(order);return;}
     if(['failed','cancelled','refunded','charged_back'].includes(order.status)){showTerminal(order);return;}
     if(order.status==='in_mediation'){showMediation(order);return;}
    }catch{}
   }
   setMessage('O pagamento continua em análise. Não tente pagar novamente enquanto o Mercado Pago estiver processando esta transação.');
  }finally{polling=false;}
 }

 async function submitCardPayment(){
  if(flowBusy||!context||!cardForm)return;
  const data=normalizeCardData(cardForm.getCardFormData());
  if(!data.token||!data.paymentMethodId||!Number.isInteger(data.installments)||data.installments<1){setMessage('Confira os dados do cartão antes de continuar.');return;}
  flowBusy=true;const submit=get('#form-checkout__submit');if(submit){submit.disabled=true;submit.textContent='Processando pagamento…';}setMessage('Enviando o pagamento com segurança…');
  try{
   const attemptStorage=paymentAttemptStorageKey(context.prepared.orderId);
   attemptKey=storageGet(attemptStorage)||attemptKey||crypto.randomUUID();storageSet(attemptStorage,attemptKey);
   const result=await api('/api/card/pay',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':context.csrf,'Idempotency-Key':attemptKey},body:JSON.stringify({orderId:context.prepared.orderId,card:data})});
   storageSet('jewelry.pendingOrder',result.orderId);
   if(result.status==='paid'){showPaid(result);return;}
   if(result.providerStatusDetail==='pending_challenge'){showChallenge(result);return;}
   if(['processing','pending'].includes(result.status)){setMessage('Pagamento recebido e em análise pelo Mercado Pago…');pollOrder(result.orderId);return;}
   if(result.status==='in_mediation'){showMediation(result);return;}
   showTerminal(result);
  }catch(error){
   setMessage(error.message||'Não foi possível processar o pagamento. Tente novamente com a mesma tentativa para evitar cobrança duplicada.');
   if(submit){submit.disabled=false;submit.textContent='Tentar novamente';}
  }finally{flowBusy=false;const bar=get('#card-payment-progress');bar?.setAttribute('value','0');}
 }

 async function beginCardPayment(){
  if(flowBusy)return;
  const delivery=get('#delivery-form');if(!delivery?.reportValidity())return;
  const selected=get('input[name="shipping-choice"]:checked');if(!selected){const msg=get('#shipping-message');if(msg)msg.textContent='Selecione uma opção de entrega antes de pagar.';return;}
  const items=cartItems();if(!items.length)return;

  flowBusy=true;checkoutButton.disabled=true;checkoutButton.textContent='Confirmando pedido…';
  try{
   const [session,catalog]=await Promise.all([api('/api/session'),api('/api/products')]);
   if(!catalog.cardFormConfigured||!catalog.mercadoPagoPublicKey)throw new Error('O pagamento por cartão ainda não está configurado.');
   const prepareKey=crypto.randomUUID(),address=addressData();
   const prepared=await api('/api/card/prepare',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':prepareKey},body:JSON.stringify({items,address,quoteId:selected.value})});
   storageSet('jewelry.cardPrepare',JSON.stringify({orderId:prepared.orderId,prepareKey}));storageSet('jewelry.pendingOrder',prepared.orderId);
   context={csrf:session.csrfToken,prepared};attemptKey=storageGet(paymentAttemptStorageKey(prepared.orderId))||null;
   showPanel();await initializeCardForm(catalog.mercadoPagoPublicKey);setMessage('');
  }catch(error){const msg=get('#cart-message');if(msg){msg.hidden=false;msg.textContent=error.message||'Não foi possível abrir o pagamento.';}resetPanel();}
  finally{flowBusy=false;checkoutButton.disabled=false;checkoutButton.textContent='Finalizar compra';}
 }

 checkoutButton.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();beginCardPayment();},true);
})();
