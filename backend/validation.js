import {createHash} from 'node:crypto';
export class AppError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
export const fail=(status,code,message)=>{throw new AppError(status,code,message);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function canonicalCart(body,catalog){
  if(!plain(body)||Object.keys(body).length!==1||!Array.isArray(body.items)||body.items.length<1||body.items.length>5)
    fail(400,'invalid_cart','Envie apenas items, com um a cinco produtos.');
  const seen=new Set();let units=0;
  const items=body.items.map(item=>{
    if(!plain(item)||Object.keys(item).sort().join(',')!=='productId,quantity') fail(400,'invalid_item','Envie apenas productId e quantity em cada item.');
    const {productId,quantity}=item;
    if(typeof productId!=='string'||!/^produto_0[1-5]$/.test(productId)||seen.has(productId)) fail(400,'invalid_product','Produto inválido ou repetido.');
    const product=catalog.find(p=>p.productId===productId);if(!product)fail(400,'invalid_product','Produto não encontrado.');
    if(!Number.isSafeInteger(quantity)||quantity<1||quantity>product.maxQuantity)fail(400,'invalid_quantity','Quantidade fora do limite permitido.');
    if(!product.enabled)fail(409,'unavailable_product','Um produto está indisponível. Remova-o do carrinho.');
    seen.add(productId);units+=quantity;return {productId,quantity};
  }).sort((a,b)=>a.productId.localeCompare(b.productId));
  if(units>50)fail(400,'quantity_limit','Limite de 50 unidades por pedido.');
  return {items,hash:createHash('sha256').update(JSON.stringify(items)).digest('hex')};
}
export function calculate(items,catalog){
  let total=0;
  const lines=items.map(({productId,quantity})=>{
    const p=catalog.find(p=>p.productId===productId);
    if(!Number.isSafeInteger(p.priceCents)||p.priceCents<=0||p.priceCents>100000000)fail(503,'catalog_not_configured','Os preços ainda não estão disponíveis para compra.');
    const subtotal=p.priceCents*quantity;total+=subtotal;
    return {productId,name:p.name,unitPrice:p.priceCents,quantity,subtotal};
  });
  if(!Number.isSafeInteger(total)||total>100000000)fail(400,'total_limit','Valor do pedido acima do limite permitido.');
  return {items:lines,total,currency:'BRL'};
}
export function money(cents){if(!Number.isSafeInteger(cents)||cents<0)throw Error('Invalid cents');return `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;}
export function cents(value){
  if(typeof value==='number'){
    if(!Number.isFinite(value)||value<0||value>100000000)fail(502,'invalid_provider_amount','Valor inválido retornado pelo provedor.');
    const result=Math.round(value*100);if(!Number.isSafeInteger(result)||Math.abs(value*100-result)>1e-7)fail(502,'invalid_provider_amount','Valor inválido retornado pelo provedor.');return result;
  }
  if(typeof value!=='string'||!/^\d{1,10}(\.\d{1,2})?$/.test(value))fail(502,'invalid_provider_amount','Valor inválido retornado pelo provedor.');
  const [whole,fraction='']=value.split('.');const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(result))fail(502,'invalid_provider_amount','Valor inválido retornado pelo provedor.');return result;
}
export const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function validCheckoutURL(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='www.mercadopago.com.br'&&u.pathname.startsWith('/checkout/')&&!u.username&&!u.password&&(!u.port||u.port==='443');}catch{return false;}}
