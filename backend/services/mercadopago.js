import {cents,money,fail} from '../validation.js';

const chargeLines=order=>order.shipping?.priceCents?[...order.items,{name:'Frete — '+order.shipping.name,quantity:1,unitPrice:order.shipping.priceCents,subtotal:order.shipping.priceCents}]:order.items;

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

function safeTicketUrl(value){
  const raw=String(value||'');if(!raw||raw.length>2048)return '';
  try{const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||!(url.hostname==='mercadopago.com.br'||url.hostname.endsWith('.mercadopago.com.br')))return '';return url.toString();}catch{return '';}
}

export function pixPaymentData(remote){
  const data=remote?.point_of_interaction?.transaction_data;
  if(!data||String(remote?.payment_method_id||'').toLowerCase()!=='pix')return null;
  const qrCode=String(data.qr_code||''),qrCodeBase64=String(data.qr_code_base64||''),ticketUrl=safeTicketUrl(data.ticket_url),expiresAt=typeof remote?.date_of_expiration==='string'&&Number.isFinite(Date.parse(remote.date_of_expiration))?remote.date_of_expiration:null;
  if(!qrCode||qrCode.length>12000||!/^[0-9A-Za-z .,:;_+*/$%#@!?&=()\-[\]{}]+$/.test(qrCode))return null;
  if(!qrCodeBase64||qrCodeBase64.length>3000000||!/^[A-Za-z0-9+/=]+$/.test(qrCodeBase64))return null;
  return {qrCode,qrCodeBase64,ticketUrl,expiresAt};
}

export function createGateway({accessToken,sellerId,applicationId,baseURL,mode='test',fetchImpl=fetch,timeoutMs=8000}){
  const configured=Boolean(mode!=='disabled'&&accessToken&&/^\d+$/.test(sellerId||'')&&/^\d+$/.test(applicationId||'')&&baseURL?.startsWith('https://'));
  const cardConfigured=configured,pixConfigured=configured;

  async function request(path,options={}){
    if(!configured)fail(503,'gateway_not_configured','O pagamento online ainda não está disponível.');
    let response;
    try{
      response=await fetchImpl('https://api.mercadopago.com'+path,{...options,redirect:'error',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json',Accept:'application/json',...options.headers},signal:AbortSignal.timeout(timeoutMs)});
    }catch(error){
      console.error(JSON.stringify({event:'mercadopago_network_error',path,error:error?.name||'network_error'}));
      fail(502,'gateway_unavailable',mode==='test'?`Diagnóstico Mercado Pago: falha de rede (${error?.name||'network_error'}).`:'O provedor não respondeu. A mesma tentativa deve ser reutilizada para evitar cobrança duplicada.');
    }
    const raw=await response.text();let data=null;try{data=raw?JSON.parse(raw):null;}catch{}
    if(!response.ok){
      const sourceDetails=Array.isArray(data?.details)?data.details:Array.isArray(data?.cause)?data.cause:[];
      const details=sourceDetails.slice(0,5).map(d=>typeof d==='string'?d:{code:String(d?.code||'').slice(0,80),description:String(d?.description||d?.message||'').slice(0,240)});
      console.error(JSON.stringify({event:'mercadopago_rejected',path,status:response.status,error:String(data?.error||'').slice(0,100),message:String(data?.message||'').slice(0,300),details}));
      if(mode==='test'){
        const parts=[`HTTP ${response.status}`];if(data?.error)parts.push(String(data.error).slice(0,100));if(data?.message)parts.push(String(data.message).slice(0,300));if(details.length)parts.push(JSON.stringify(details).slice(0,1000));
        fail(502,'gateway_rejected',`Diagnóstico Mercado Pago: ${parts.join(' — ')}`);
      }
      fail(502,'gateway_rejected','Não foi possível processar o pagamento. Confira os dados e tente novamente.');
    }
    if(data!==null)return data;
    fail(502,'gateway_invalid',mode==='test'?'Diagnóstico Mercado Pago: resposta sem JSON válido.':'Resposta inválida do provedor.');
  }

  function verifyPaymentIdentity(remote,local){
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
    verifyPaymentIdentity(data,order);
    return data;
  }

  async function createPixPayment(order,payer,idempotencyKey){
    const lines=chargeLines(order),parts=String(order.customer?.name||'Cliente').trim().split(/\s+/),firstName=parts.shift()||'Cliente',lastName=parts.join(' ')||'Cliente';
    const body={
      transaction_amount:Number(money(order.total)),
      description:'Dobrões de Fé',
      payment_method_id:'pix',
      payer:{email:String(order.customer?.email||'').toLowerCase(),first_name:firstName,last_name:lastName,identification:{type:payer.identificationType,number:payer.identificationNumber}},
      external_reference:order.orderId,
      date_of_expiration:new Date(Date.now()+30*60*1000).toISOString(),
      additional_info:{items:lines.map((item,index)=>({id:String(index+1),title:item.name,description:item.name,category_id:'others',quantity:item.quantity,unit_price:Number(money(item.unitPrice))}))}
    };
    const data=await request('/v1/payments',{method:'POST',headers:{'X-Idempotency-Key':idempotencyKey},body:JSON.stringify(body)});
    verifyPaymentIdentity(data,order);
    if(String(data.payment_method_id||'').toLowerCase()!=='pix')fail(409,'provider_method_mismatch','O meio de pagamento retornado não corresponde ao Pix.');
    return data;
  }

  return {
    configured,cardConfigured,pixConfigured,
    async createCardPayment(order,card,idempotencyKey){return createCardPayment(order,card,idempotencyKey);},
    async createPixPayment(order,payer,idempotencyKey){return createPixPayment(order,payer,idempotencyKey);},
    async getPayment(id){if(!/^\d{6,32}$/.test(String(id||'')))fail(400,'invalid_provider_id','Identificador de pagamento inválido.');return request('/v1/payments/'+encodeURIComponent(String(id)));},
    async cancelPayment(id){if(!/^\d{6,32}$/.test(String(id||'')))fail(400,'invalid_provider_id','Identificador de pagamento inválido.');return request('/v1/payments/'+encodeURIComponent(String(id)),{method:'PUT',body:JSON.stringify({status:'cancelled'})});},
    verifyCardPaymentIdentity:verifyPaymentIdentity,
    verifyPaymentIdentity
  };
}

export function cardPaymentSnapshot(remote,local,gateway){
  const verify=gateway.verifyPaymentIdentity||gateway.verifyCardPaymentIdentity;verify(remote,local);
  const paymentId=String(remote.id);
  const updatedAt=[remote.date_last_updated,remote.date_created].find(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))||new Date().toISOString();
  const detail=String(remote.status_detail||'');
  let status='processing';
  if(remote.status==='approved'&&detail==='partially_refunded')status='partially_refunded';
  else if(remote.status==='approved')status='paid';
  else if(['pending','in_process','authorized'].includes(remote.status))status='processing';
  else if(remote.status==='rejected')status='failed';
  else if(remote.status==='cancelled')status='cancelled';
  else if(remote.status==='refunded')status='refunded';
  else if(remote.status==='charged_back')status='charged_back';
  else if(remote.status==='in_mediation')status='in_mediation';
  else fail(409,'unknown_provider_status','Status de pagamento desconhecido: conferência manual necessária.');
  return {providerOrderId:paymentId,status,detail,updatedAt,paymentId};
}

export function cardPaymentChallenge(remote){return safeChallenge(remote);}
