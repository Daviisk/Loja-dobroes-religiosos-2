(()=>{
 'use strict';
 const {Cart,clean,KEY}=window.JewelryCartModel;
 const get=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
 function ensureSaoBentoCategory(){
  const categories=get('.categories');if(!categories)return;
  categories.classList.add('saints-real-card');
  let article=categories.querySelector('.category-sao-bento');
  if(!article){
   article=document.createElement('article');article.className='category category-sao-bento';
   article.innerHTML='<a href="#galeria" class="round-photo" data-category-link="sao-bento"><img src="images/sao-bento.webp" alt="Ilustração de São Bento" width="290" height="290" loading="lazy"></a><h2>São Bento</h2><p>Oração e devoção</p><a class="text-link" href="#galeria" data-category-link="sao-bento">Conhecer dobrão <span aria-hidden="true">›</span></a>';
   categories.append(article);
  }
  if(!get('#real-saint-card-fix')){
   const style=document.createElement('style');style.id='real-saint-card-fix';
   style.textContent='.categories.saints-real-card::before,.categories.saints-real-card::after{content:none!important;display:none!important}@media(min-width:801px){.categories.saints-real-card{grid-template-columns:repeat(5,minmax(0,1fr));gap:20px}}@media(max-width:800px) and (min-width:621px){.categories.saints-real-card{grid-template-columns:repeat(3,minmax(0,1fr))}.categories.saints-real-card .category-sao-bento{grid-column:2}}@media(max-width:620px){.categories.saints-real-card{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 16px}.categories.saints-real-card .category-sao-bento{grid-column:1/-1;width:min(235px,100%);justify-self:center;margin:0 auto}.categories.saints-real-card .category-sao-bento .round-photo{margin-bottom:16px}.categories.saints-real-card .category-sao-bento h2{font-size:18px;line-height:1.35;margin-bottom:13px}.categories.saints-real-card .category-sao-bento p{font-size:14px;line-height:1.85}.categories.saints-real-card .category-sao-bento .text-link{font-size:13px;min-height:44px;margin-top:6px}}';
   document.head.append(style);
  }
  article.querySelectorAll('[data-category-link="sao-bento"]').forEach(link=>link.addEventListener('click',()=>get('[data-filter="sao-bento"]')?.click()));
 }
 ensureSaoBentoCategory();
 const cards=new Map(all('.piece[data-product-id]').map(card=>[card.dataset.productId,card]));
 let storage;try{storage=localStorage;}catch{storage={getItem(){return null;},setItem(){throw Error('unavailable');}};}
 const cart=new Cart(storage),drawer=get('#cart-drawer');
 let products=new Map(),csrf='',loading=true,busy=false,key=null,review=null,checkoutConfigured=false,toastTimer;
 const form=get('#delivery-form');let selectedQuote=null,quoteBusy=false,addressBusy=false,quoteVersion=0;
 // Preview prices are display-only. Checkout always uses the server catalog.
 // Embedded/HTTPS previews also lack the API: keep display prices in every preview.
 // checkoutConfigured stays false until the backend explicitly enables checkout.
 products=new Map([...cards].map(([id,card])=>[id,{productId:id,name:card.querySelector('h3').textContent,priceCents:15000,enabled:true,maxQuantity:10}]));
 const cash=n=>Number.isSafeInteger(n)&&n>=0?(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'A definir';
 const create=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
 const notice=(text)=>{const box=get('#cart-message');box.textContent=text;box.hidden=!text;};
 function toast(text){get('#cart-toast').textContent=text;get('#cart-toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>get('#cart-toast').hidden=true,4500);}
 function invalidateQuote(){selectedQuote=null;quoteVersion++;get('#shipping-options').replaceChildren();get('#shipping-options').hidden=true;get('#shipping-message').textContent='Informe seu CEP e calcule o frete para este carrinho.';}
 function changed(){key=null;review=null;invalidateQuote();render();}
 form.addEventListener('submit',e=>e.preventDefault());
 const cepInput=get('#delivery-cep'),addressLookup=get('#address-lookup');
 function formatCep(value){const digits=String(value).replace(/\D/g,'').slice(0,8);return digits.length>5?digits.slice(0,5)+'-'+digits.slice(5):digits;}
 function clearPending(){key=null;review=null;invalidateQuote();render();}
 async function lookupAddress(){
  const cep=cepInput.value.replace(/\D/g,'');cepInput.value=formatCep(cep);
  if(!/^\d{8}$/.test(cep)){get('#shipping-message').textContent='Informe os 8 números do CEP para buscar o endereço.';cepInput.focus();return;}
  addressBusy=true;addressLookup.disabled=true;addressLookup.textContent='Buscando…';get('#shipping-message').textContent='Buscando endereço pelo CEP…';
  try{
   const response=await fetch('https://viacep.com.br/ws/'+cep+'/json/',{cache:'no-store',signal:AbortSignal.timeout(10000)});const address=await response.json();
   if(!response.ok||address.erro)throw Error('CEP não encontrado. Confira os números e tente novamente.');
   get('#delivery-street').value=address.logradouro||'';get('#delivery-district').value=address.bairro||'';get('#delivery-city').value=address.localidade||'';get('#delivery-state').value=address.uf||'';
   clearPending();get('#shipping-message').textContent='Endereço encontrado. Confira os campos e informe o número.';(address.logradouro?get('#delivery-number'):get('#delivery-street')).focus();
  }catch(e){get('#shipping-message').textContent=e.message||'Não foi possível buscar o endereço agora. Preencha os campos manualmente.';}
  finally{addressBusy=false;addressLookup.disabled=false;addressLookup.textContent='Buscar endereço';}
 }
 cepInput.addEventListener('input',()=>{cepInput.value=formatCep(cepInput.value);clearPending();});
 cepInput.addEventListener('blur',()=>{if(cepInput.value.replace(/\D/g,'').length===8)lookupAddress();});
 addressLookup.addEventListener('click',lookupAddress);
 form.addEventListener('input',e=>{if(e.target.name!=='cep'){key=null;review=null;render();}});
 form.addEventListener('change',()=>{key=null;review=null;render();});
 get('#shipping-calculate').addEventListener('click',async()=>{
  if(quoteBusy||busy||!cart.items.length)return;
  const cep=get('#delivery-cep');if(!cep.reportValidity())return;
  invalidateQuote();const version=quoteVersion;quoteBusy=true;render();get('#shipping-message').textContent='Consultando preço e prazo…';
  try{
   if(!/^https?:$/.test(location.protocol))throw Error('Abra a loja pelo servidor para calcular o frete real.');
   if(!csrf)throw Error('Atualize a conexão da loja antes de calcular o frete.');
   const result=await api('/api/shipping/quote',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({...cart.payload(),cep:cep.value})});
   if(version!==quoteVersion)return;
   const options=get('#shipping-options');options.replaceChildren(create('legend','Escolha a entrega'));
   for(const quote of result.options){const label=create('label',undefined,'shipping-option'),radio=create('input');radio.type='radio';radio.name='shipping-choice';radio.value=quote.quoteId;radio.addEventListener('change',()=>{selectedQuote=quote;key=null;review=null;render();});label.append(radio,create('span',`${quote.name} — ${cash(quote.priceCents)} · ${quote.days} dia(s) útil(eis) após postagem`));options.append(label);}
   options.hidden=false;get('#shipping-message').textContent='Selecione uma opção. Cotação válida por 10 minutos.';
  }catch(e){if(version===quoteVersion)get('#shipping-message').textContent=e.message;}finally{quoteBusy=false;render();}
 });
 function open(){render();if(!drawer.open)drawer.showModal();document.body.classList.add('cart-open');}
 function close(){drawer.close();}
 get('#cart-toggle').addEventListener('click',open);get('#cart-close').addEventListener('click',close);get('#cart-continue').addEventListener('click',close);
 drawer.addEventListener('close',()=>{document.body.classList.remove('cart-open');get('#cart-toggle').focus();});
 drawer.addEventListener('click',e=>{if(e.target===drawer){const r=drawer.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right)close();}});
 all('[data-add-product]').forEach(button=>button.addEventListener('click',()=>{
  if(busy)return;const id=button.dataset.addProduct,product=products.get(id);if(product?.enabled===false){toast('Este produto está indisponível.');return;}
  if(!cart.add(id,product?.maxQuantity||10)){toast('Você atingiu o limite de quantidade deste produto.');return;}changed();toast('Produto adicionado ao carrinho.');
 }));
 get('#cart-clear').addEventListener('click',()=>{if(busy)return;cart.clear();changed();notice('');});
 function render(){
  for(const [id,card] of cards){
   const product=products.get(id),label=card.querySelector('[data-product-price]');
   if(label)label.textContent=product?.enabled===false?'Indisponível':cash(product?.priceCents);
  }

  const focused=document.activeElement?.dataset?.cartFocus;
  get('#cart-count').textContent=cart.items.reduce((n,item)=>n+item.quantity,0);
  get('#cart-toggle').setAttribute('aria-label',`Abrir carrinho, ${get('#cart-count').textContent} itens`);
  const empty=!cart.items.length;get('#cart-empty').hidden=!empty;get('#cart-filled').hidden=empty;get('#cart-review').hidden=!review;
  const lines=get('#cart-lines');lines.replaceChildren();let total=0,ready=!empty;
  for(const item of cart.items){
   const product=products.get(item.productId),card=cards.get(item.productId);if(!card)continue;
   const line=create('article',undefined,'cart-line'),img=create('img');img.src=card.querySelector('img').src;img.alt=card.querySelector('img').alt;line.append(img);
   const body=create('div');body.append(create('h3',product?.name||card.querySelector('h3').textContent));
   const max=product?.maxQuantity||10,available=product?.enabled!==false,valid=Number.isSafeInteger(product?.priceCents)&&product.priceCents>0&&available&&item.quantity<=max;
   if(!valid)ready=false;
   const unit=valid?product.priceCents:null,subtotal=valid?unit*item.quantity:null;total+=subtotal||0;
   body.append(create('p',!available?'Produto indisponível':item.quantity>max?'Quantidade acima do limite atual':`Unidade: ${cash(unit)}`));
   const controls=create('div',undefined,'cart-quantity'),minus=create('button','−'),input=create('input'),plus=create('button','+');
   minus.type=plus.type='button';minus.setAttribute('aria-label',`Diminuir quantidade de ${card.querySelector('h3').textContent}`);plus.setAttribute('aria-label',`Aumentar quantidade de ${card.querySelector('h3').textContent}`);
   minus.dataset.cartFocus=item.productId+'-minus';plus.dataset.cartFocus=item.productId+'-plus';input.dataset.cartFocus=item.productId+'-quantity';
   input.type='number';input.min='1';input.max=String(max);input.step='1';input.value=item.quantity;input.inputMode='numeric';input.setAttribute('aria-label',`Quantidade de ${card.querySelector('h3').textContent}`);
   minus.disabled=busy||item.quantity<=1;plus.disabled=busy||item.quantity>=max||!available;input.disabled=busy;
   const change=q=>{if(busy)return;if(!cart.set(item.productId,q,max)){notice(`Use uma quantidade inteira entre 1 e ${max}.`);input.value=item.quantity;return;}notice('');changed();};
   minus.addEventListener('click',()=>change(item.quantity-1));plus.addEventListener('click',()=>change(item.quantity+1));input.addEventListener('change',()=>change(Number(input.value)));
   controls.append(minus,input,plus);body.append(controls);
   const bottom=create('div',undefined,'cart-line-bottom'),remove=create('button','Remover','cart-remove');remove.dataset.cartFocus=item.productId+'-remove';remove.type='button';remove.disabled=busy;remove.setAttribute('aria-label',`Remover ${card.querySelector('h3').textContent}`);remove.addEventListener('click',()=>{cart.remove(item.productId);changed();});bottom.append(create('strong',cash(subtotal)),remove);body.append(bottom);line.append(body);lines.append(line);
  }
  get('#cart-total').textContent=ready?cash(total):'A definir';
  if(selectedQuote&&selectedQuote.expiresAt<=Date.now()){invalidateQuote();get('#shipping-message').textContent='A cotação expirou. Calcule o frete novamente.';}
  get('#shipping-total').textContent=selectedQuote?cash(selectedQuote.priceCents):'A calcular';get('#grand-total').textContent=ready&&selectedQuote?cash(total+selectedQuote.priceCents):'A calcular';
  get('#shipping-calculate').disabled=busy||quoteBusy||!ready;get('#shipping-calculate').textContent=quoteBusy?'Calculando frete…':'Calcular frete pelo CEP';
  all('#delivery-form input,#delivery-form select').forEach(el=>el.disabled=busy);addressLookup.disabled=busy||addressBusy;
  const submit=get('#cart-checkout');submit.disabled=busy||loading||!ready||!checkoutConfigured||!selectedQuote;submit.textContent=busy?'Criando checkout…':loading?'Carregando preços…':'Finalizar compra';get('#cart-clear').disabled=busy;
  all('[data-add-product]').forEach(button=>{const p=products.get(button.dataset.addProduct);button.disabled=busy||p?.enabled===false;button.textContent=p?.enabled===false?'Indisponível':'Adicionar ao carrinho';});
  if(review){get('#checkout-review-items').replaceChildren(...review.items.map(item=>create('li',`${item.quantity} × ${item.name} — ${cash(item.subtotal)}`)));if(review.shipping)get('#checkout-review-items').append(create('li',`${review.shipping.name}: ${cash(review.shipping.priceCents)}`));if(review.address)get('#checkout-review-items').append(create('li',`Entrega: ${review.address.street}, ${review.address.number}, ${review.address.complement} — ${review.address.district}, ${review.address.city}/${review.address.state}, CEP ${review.address.cep}`));get('#checkout-review-total').textContent=cash(review.total);get('#checkout-order-id').textContent=`Pedido ${review.orderId}`;get('#checkout-go').href=review.checkoutUrl;}
  if(focused){const target=all('[data-cart-focus]').find(el=>el.dataset.cartFocus===focused);if(target&&!target.disabled)target.focus();else if(drawer.open)get('#cart-close').focus();}
 }
 async function api(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,signal:AbortSignal.timeout(15000)});let data;try{data=await response.json();}catch{throw Error('Não foi possível carregar a loja. Tente novamente.');}
  if(!response.ok)throw Error(data.message||'Não foi possível concluir a operação.');return data;
 }
 async function refresh(){
  loading=true;invalidateQuote();review=null;key=null;render();notice('Carregando preços e disponibilidade…');
  try{
   if(location.hostname.endsWith('.github.io'))throw Error('Modo de demonstração: você pode montar o carrinho. Frete e pagamento estarão disponíveis quando a loja estiver conectada ao servidor.');
   if(!/^https?:$/.test(location.protocol))throw Error('Para comprar, abra a loja pelo servidor. Nesta prévia, você pode montar o carrinho.');
   const [session,catalog]=await Promise.all([api('/api/session'),api('/api/products')]);csrf=session.csrfToken;products=new Map(catalog.products.map(p=>[p.productId,p]));checkoutConfigured=catalog.checkoutConfigured;
   notice(!cart.persisted?'Seu navegador não permitiu salvar o carrinho.':!checkoutConfigured?'As compras online ainda não estão disponíveis.':catalog.products.some(p=>p.enabled&&p.priceCents===null)?'Alguns produtos ainda estão com preço a definir.':'');
  }catch(e){checkoutConfigured=false;notice(e.message);}finally{loading=false;render();}
 }
 get('#cart-retry').addEventListener('click',()=>{if(!busy)refresh();});
 get('#cart-checkout').addEventListener('click',async()=>{
  if(busy||!cart.items.length||!selectedQuote)return;
  if(!form.reportValidity())return;
  if(selectedQuote.expiresAt<=Date.now()){invalidateQuote();render();notice('Calcule o frete novamente.');return;}
  const address=Object.fromEntries([...new FormData(form)].filter(([key])=>key!=='shipping-choice'));
  busy=true;review=null;notice('Validando seu carrinho e criando o checkout…');render();
  try{
   key=key||crypto.randomUUID();const result=await api('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key},body:JSON.stringify({...cart.payload(),address,quoteId:selectedQuote.quoteId})});
   if(result.status==='paid'){notice('Este pedido já foi pago. Confira o acompanhamento antes de comprar novamente.');return;}
   if(!result.checkoutUrl)throw Error('Este pedido não está mais disponível para pagamento.');
   const url=new URL(result.checkoutUrl);if(url.protocol!=='https:'||url.hostname!=='www.mercadopago.com.br'||!url.pathname.startsWith('/checkout/')||url.username||url.password)throw Error('Não foi possível abrir um checkout válido.');
   review=result;try{sessionStorage.setItem('jewelry.pendingOrder',result.orderId);}catch{}
   notice('Pedido criado. Confira os valores confirmados pela loja antes de continuar.');
  }catch(e){notice(e.message||'Falha ao criar checkout. Você pode tentar novamente.');}finally{busy=false;render();}
 });
 window.addEventListener('storage',event=>{if(event.key===KEY&&!busy){cart.items=clean(event.newValue);cart.save();changed();}});
 render();refresh();
})();
