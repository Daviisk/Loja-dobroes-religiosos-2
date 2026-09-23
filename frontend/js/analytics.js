(()=>{
 'use strict';
 const allowed=new Set(['page_view','product_view','add_to_cart']);
 function track(event,productId=''){
  if(!allowed.has(event)||!/^https?:$/.test(location.protocol))return;
  const body={event,path:location.pathname||'/',productId:String(productId||'').slice(0,80)};
  try{fetch('/api/analytics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true,credentials:'same-origin'}).catch(()=>{});}catch{}
 }
 window.ShopAnalytics={track};
 track('page_view');
 const seen=new Set();
 if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const id=entry.target?.dataset?.productId;if(id&&!seen.has(id)){seen.add(id);track('product_view',id);observer.unobserve(entry.target);}}},{threshold:.45});document.querySelectorAll('.piece[data-product-id]').forEach(el=>observer.observe(el));}
 document.addEventListener('click',event=>{const button=event.target.closest?.('[data-add-product]');if(button&&!button.disabled)track('add_to_cart',button.dataset.addProduct||'');},{capture:true});
})();
