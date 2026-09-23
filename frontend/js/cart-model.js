(function(root){
 'use strict';
 const KEY='jewelry.cart.v1',IDS=['produto_01','produto_02','produto_03','produto_04','produto_05'];
 function clean(value){
  try{if(typeof value==='string'){if(value.length>32768)return [];value=JSON.parse(value);}if(!value||!Array.isArray(value.items)||value.items.length>50)return [];
   const result=new Map();for(const item of value.items){if(!item||!IDS.includes(item.productId)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>10)continue;const q=(result.get(item.productId)||0)+item.quantity;if(q<=10)result.set(item.productId,q);}
   return [...result].map(([productId,quantity])=>({productId,quantity})).sort((a,b)=>a.productId.localeCompare(b.productId));
  }catch{return [];}
 }
 class Cart {
  constructor(storage){this.storage=storage;this.persisted=true;try{this.items=clean(storage.getItem(KEY));}catch{this.items=[];this.persisted=false;}this.save();}
  save(){try{this.storage.setItem(KEY,JSON.stringify({items:this.items}));}catch{this.persisted=false;}}
  add(id,max=10){if(!IDS.includes(id))return false;const old=this.items.find(i=>i.productId===id);if(old&&old.quantity>=max)return false;if(old)old.quantity++;else this.items.push({productId:id,quantity:1});this.items.sort((a,b)=>a.productId.localeCompare(b.productId));this.save();return true;}
  set(id,quantity,max=10){const item=this.items.find(i=>i.productId===id);if(!item||!Number.isSafeInteger(quantity)||quantity<1||quantity>Math.min(max,10))return false;item.quantity=quantity;this.save();return true;}
  remove(id){this.items=this.items.filter(i=>i.productId!==id);this.save();}
  clear(){this.items=[];this.save();}
  payload(){return {items:this.items.map(({productId,quantity})=>({productId,quantity}))};}
 }
 root.JewelryCartModel={Cart,clean,KEY,IDS};
})(globalThis);

/* Isolated visual bootstrap. Keeping this outside the cart model prevents the
   theme switch from changing cart state or checkout behaviour. */
(()=>{
 'use strict';
 if(typeof document==='undefined')return;
 try{document.documentElement.dataset.theme=localStorage.getItem('signum.theme')==='dark'?'dark':'light';}catch{document.documentElement.dataset.theme='light';}
 if(document.querySelector('script[data-signum-theme]'))return;
 const script=document.createElement('script');
 script.src='/js/theme.js';script.async=false;script.dataset.signumTheme='true';
 document.head.append(script);
})();
