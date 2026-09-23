import {cents,money,fail,validCheckoutURL} from '../validation.js';

const chargeLines=order=>order.shipping?.priceCents?[...order.items,{name:'Frete — '+order.shipping.name,quantity:1,unitPrice:order.shipping.priceCents,subtotal:order.shipping.priceCents}]:order.items;

export function checkoutPayload(order,baseURL){
  const back=baseURL+'/sucesso?orderId='+order.orderId;
  return {type:'online',processing_mode:'manual',total_amount:money(order.total),external_reference:order.orderId,expiration_time:'P1D',
    items:chargeLines(order).map(item=>({title:item.name,quantity:item.quantity,unit_price:money(item.unitPrice)})),
    config:{online:{success_url:back,failure_url:back,pending_url:back,auto_return:'all'}}};
}

function safeChallenge(remote){
  if(remote?.status!=='pending'||remote?.status_detail!=='pending_challenge')return null;
  const externalResourceUrl=String(remote?.three_ds_info?.external_resource_url||'');
  const creq=String(remote?.three_ds_info?.creq||'');
  if(!externalResourceUrl||!creq||creq.length>12000)return null;
  try{
    const url=new URL(externalResourceUrl);
    if(url.protocol!=='https:'||url.username||url.password||externalResourceUrl.length>2048)return null;
    return {externalResourceUrl:url.toString(),creq};
  }catch{return null;}
}

export function createGateway({accessToken,sellerId,applicationId,baseURL,mode='test',fetchImpl=fetch}){
  const configured=Boolean(mode!=='disabled'&&accessToken&&/^\d+$/.test(sellerId||'')&&/^\d+$/.test(applicationId||'')&&baseURL?.startsWith('https://'));
  const cardConfigured=configured;

  async function request(path,options={}){
    if(!configured)fail(503,'gateway_not_configured','O pagamento online ainda não está disponível.');
    let response;
    try{
      response=await fetchImpl('https://api.mercadopago.com'+path,{...options,redirect:'error',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json',Accept:'application/json',...options.headers},signal:AbortSignal.timeout(15000)});
    }catch(error){
      console.error(JSON.stringify({event:'mercadopago_network_error',path,error:error?.name||'network_error'}));
      fail(502,'gateway_unavailable',mode==='test'?`Diagnóstico Mercado Pago: falha de rede (${error?.name||'network_error'}).`:'O provedor não respondeu. Tente novamente: a mesma tentativa será reutilizada.');
    }
    const raw=await response.text();let data=null;try{data=raw?JSON.parse(raw):null;}catch{}
    if(!response.ok){
      const sourceDetails=Array.isArray(data?.details)?data.details:Array.isArray(data?.cause)?data.cause:[];
      const details=sourceDetails.slice(0,5).map(d=>typeof d==='string'?d:{code:String(d?.code||'').slice(0,80),description:String(d?.description||d?.message||'').slice(0,240),details:Array.isArray(d?.details)?d.details.slice(0,5):undefined});
      console.error(JSON.stringify({event:'mercadopago_rejected',path,status:response.status,error:String(data?.error||'').slice(0,100),message:String(data?.message||'').slice(0,300),details}));
      if(mode==='test'){
        const parts=[`HTTP ${response.status}`];if(data?.error)parts.push(String(data.error).slice(0,100));if(data?.message)parts.push(String(data.message).slice(0,300));if(details.length)parts.push(JSON.stringify(details).slice(0,1000));else if(raw)parts.push(raw.slice(0,1000));
        fail(502,'gateway_rejected',`Diagnóstico Mercado Pago: ${parts.join(' — ')}`);
      }
      fail(502,'gateway_rejected','Não foi possível processar o pagamento. Confira os dados e tente novamente.');
    }
    if(data!==null)return data;
    fail(502,'gateway_invalid',mode==='test'?'Diagnóstico Mercado Pago: resposta sem JSON válido.':'Resposta inválida do provedor.');
  }

  function verifyIdentity(remote,local){
    if(!remote||remote.external_reference!==local.orderId||remote.type!=='online'||remote.processing_mode!=='manual'||remote.currency!=='BRL'||remote.country_code!=='BRA'||String(remote.user_id)!==sellerId||String(remote.integration_data?.application_id)!==applicationId||cents(remote.total_amount)!==local.total)fail(409,'provider_mismatch','Os dados do provedor não correspondem ao pedido.');
    if(typeof remote.id!=='string'||!/^ORD[A-Z0-9]{10,64}$/.test(remote.id))fail(502,'invalid_provider_id','Identificador inválido do provedor.');
    if((mode==='test')!==remote.id.startsWith('ORDTST'))fail(409,'mode_mismatch','O modo do pagamento não corresponde à configuração.');
    if(remote.live_mode!==undefined&&remote.live_mode!==(mode==='production'))fail(409,'mode_mismatch','Modo de pagamento incompatível.');
    if(remote.items){const expected=chargeLines(local).map(i=>[i.name,i.quantity,i.unitPrice]);const actual=remote.items.map(i=>[i.title,i.quantity,cents(i.unit_price)]);if(JSON.stringify(actual)!==JSON.stringify(expected))fail(409,'provider_items_mismatch','Itens diferentes do pedido original.');}
  }

  function verifyCardPaymentIdentity(remote,local){
    if(!remote||String(remote.external_reference||'')!==local.orderId)fail(409,'provider_mismatch','O pagamento não corresponde ao pedido.');
    if(!/^\d+$/.test(String(remote.id||'')))fail(502,'invalid_provider_id','Identificador de pagamento inválido.');
    if(cents(remote.transaction_amount)!==local.total)fail(409,'provider_amount_mismatch','O valor retornado pelo Mercado Pago não corresponde ao pedido.');
    if(remote.currency_id!==undefined&&remote.currency_id!=='BRL')fail(409,'provider_currency_mismatch','Moeda incompatível com o pedido.');
    if(remote.collector_id!==undefined&&String(remote.collector_id)!==String(sellerId))fail(409,'provider_seller_mismatch','O recebedor do pagamento não corresponde à loja.');
    if(remote.application_id!==undefined&&remote.application_id!==null&&String(remote.application_id)!==String(applicationId))fail(409,'provider_application_mismatch','Aplicação de pagamento incompatível.');
    if(remote.live_mode!==undefined&&remote.live_mode!==(mode==='production'))fail(409,'mode_mismatch','Modo de pagamento incompatível.');
  }

  async function createCardPayment(order,card,idempotencyKey){
    const lines=chargeLines(order);
    const body={
      transaction_amount:Number(money(order.total)),
      token:card.token,
      description:'Dobrões de Fé',
      installments:card.installments,
      payment_method_id:card.paymentMethodId,
      payer:{email:card.email,identification:{type:card.identificationType,number:card.identificationNumber}},
      external_reference:order.orderId,
      three_d_secure_mode:'optional',
      capture:true,
      binary_mode:false,
      additional_info:{items:lines.map((item,index)=>({id:String(index+1),title:item.name,description:item.name,category_id:'others',quantity:item.quantity,unit_price:Number(money(item.unitPrice))}))}
    };
    if(card.issuerId)body.issuer_id=card.issuerId;
    const data=await request('/v1/payments',{method:'POST',headers:{'X-Idempotency-Key':idempotencyKey},body:JSON.stringify(body)});
    verifyCardPaymentIdentity(data,order);
    return data;
  }

  return {
    configured,cardConfigured,
    async create(order){const data=await request('/v1/orders',{method:'POST',headers:{'X-Idempotency-Key':order.orderId},body:JSON.stringify(order.gatewayPayload)});verifyIdentity(data,order);if(!validCheckoutURL(data.checkout_url))fail(502,'invalid_checkout_url','URL de pagamento inválida.');return {providerOrderId:data.id,checkoutUrl:data.checkout_url};},
    async get(id){if(!/^ORD[A-Z0-9]{10,64}$/.test(id))fail(400,'invalid_provider_id','Identificador inválido.');return request('/v1/orders/'+encodeURIComponent(id));},
    async createCardPayment(order,card,idempotencyKey){return createCardPayment(order,card,idempotencyKey);},
    async getPayment(id){if(!/^\d{6,32}$/.test(String(id||'')))fail(400,'invalid_provider_id','Identificador de pagamento inválido.');return request('/v1/payments/'+encodeURIComponent(String(id)));},
    verifyIdentity,verifyCardPaymentIdentity
  };
}

export function paymentSnapshot(remote,local,gateway){
  gateway.verifyIdentity(remote,local);if(remote.id!==local.providerOrderId)fail(409,'provider_id_mismatch','Pagamento não associado a este pedido.');
  const updatedAt=remote.last_updated_date;if(typeof updatedAt!=='string'||!Number.isFinite(Date.parse(updatedAt)))fail(502,'invalid_provider_date','Data inválida do provedor.');
  let status='processing';const detail=remote.status_detail;
  if(remote.status==='created')status='pending';
  else if(remote.status==='processed'&&detail==='accredited'){if(cents(remote.total_paid_amount)!==local.total)fail(409,'unpaid_order','O valor integral não foi confirmado.');status='paid';}
  else if(remote.status==='refunded'||(remote.status==='processed'&&detail==='refunded'))status='refunded';
  else if(remote.status==='processed'&&detail==='partially_refunded')status='partially_refunded';
  else if(remote.status==='canceled')status='cancelled';
  else if(remote.status==='failed')status='failed';
  else if(!['processing','action_required'].includes(remote.status))fail(409,'unknown_provider_status','Status desconhecido: conferência manual necessária.');
  const payments=Array.isArray(remote.transactions?.payments)?remote.transactions.payments:[];const approved=payments.find(p=>p.status==='approved'||p.status==='processed')||payments[0];
  return {providerOrderId:remote.id,status,detail:detail||'',updatedAt,paymentId:approved?.id?String(approved.id):null};
}

export function cardPaymentSnapshot(remote,local,gateway){
  gateway.verifyCardPaymentIdentity(remote,local);
  const paymentId=String(remote.id);
  const updatedAt=[remote.date_last_updated,remote.date_created].find(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))||new Date().toISOString();
  const detail=String(remote.status_detail||'');
  let status='processing';
  if(remote.status==='approved')status='paid';
  else if(['pending','in_process','authorized'].includes(remote.status))status='processing';
  else if(remote.status==='rejected')status='failed';
  else if(remote.status==='cancelled')status='cancelled';
  else if(remote.status==='refunded')status='refunded';
  else if(remote.status==='charged_back')status='charged_back';
  else if(remote.status==='in_mediation')status='in_mediation';
  else fail(409,'unknown_provider_status','Status de pagamento desconhecido: conferência manual necessária.');
  return {providerOrderId:paymentId,status,detail,updatedAt,paymentId};
}

export function cardPaymentChallenge(remote){
  return safeChallenge(remote);
}
