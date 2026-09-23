const html=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const cash=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

function customerMessage(kind,order){
  const code=order.orderCode||String(order.orderId).slice(0,8).toUpperCase(),tracking=order.trackingCode||'';
  const common=`<p>Pedido <strong>#${html(code)}</strong></p><p>Total: <strong>${html(cash(order.total))}</strong></p>`;
  if(kind==='order.created')return {subject:`Recebemos o pedido #${code}`,body:`<h1>Pedido recebido</h1><p>Seu pedido foi criado e está aguardando a confirmação do pagamento.</p>${common}`};
  if(kind==='order.paid')return {subject:`Pagamento aprovado — pedido #${code}`,body:`<h1>Pagamento aprovado</h1><p>Recebemos a confirmação do pagamento. Agora seu pedido seguirá para preparação.</p>${common}`};
  if(kind==='order.shipped')return {subject:`Pedido #${code} enviado`,body:`<h1>Seu pedido foi enviado</h1>${common}${tracking?`<p>Código de rastreio: <strong>${html(tracking)}</strong></p>`:''}`};
  if(kind==='order.delivered')return {subject:`Pedido #${code} entregue`,body:`<h1>Pedido entregue</h1><p>O pedido foi marcado como entregue.</p>${common}`};
  if(kind==='order.refunded')return {subject:`Atualização financeira — pedido #${code}`,body:`<h1>Atualização do pagamento</h1><p>O pedido recebeu uma atualização de reembolso. Consulte o acompanhamento do pedido para verificar o status atual.</p>${common}`};
  if(kind==='order.financial_hold')return {subject:`Pagamento em análise — pedido #${code}`,body:`<h1>Pagamento em análise</h1><p>O pagamento está em análise/mediação. Não realize uma nova cobrança para este pedido enquanto a situação estiver sendo verificada.</p>${common}`};
  if(kind==='order.cancelled')return {subject:`Pedido #${code} cancelado`,body:`<h1>Pedido cancelado</h1><p>O pedido não seguirá para expedição. Consulte o acompanhamento para conferir o status do pagamento.</p>${common}`};
  return null;
}

export function createNotifier({config,store,logger=console}){
  const configured=Boolean(config.emailNotificationsEnabled&&config.resendApiKey&&config.emailFrom);
  async function send({to,subject,body,idempotencyKey}){
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${config.resendApiKey}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({from:config.emailFrom,to:[to],subject,html:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6"><div style="max-width:620px;margin:auto;padding:24px"><p style="font-weight:700">Dobrões de Fé</p>${body}<p style="font-size:12px;color:#667085">Esta é uma mensagem transacional referente ao seu pedido.</p></div></body></html>`}),signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error(`email_provider_${response.status}`);
  }
  async function flush(orderId){
    if(!configured)return {configured:false,processed:0};
    const order=await store.get(orderId);if(!order)return {configured:true,processed:0};
    const pending=await store.listPendingOutbox(orderId,{limit:20});let processed=0;
    for(const item of pending){
      const message=customerMessage(item.kind,order);if(!message){await store.markOutbox(item.id,'blocked');continue;}
      try{
        const customerEmail=String(order.customer?.email||'').trim();
        if(customerEmail)await send({to:customerEmail,...message,idempotencyKey:`customer:${item.id}`});
        if(item.kind==='order.paid'&&config.adminNotificationEmail)await send({to:config.adminNotificationEmail,subject:`Nova venda aprovada — #${order.orderCode}`,body:`<h1>Nova venda aprovada</h1><p>Pedido <strong>#${html(order.orderCode)}</strong></p><p>Cliente: ${html(order.customer?.name||'—')}</p><p>Total: <strong>${html(cash(order.total))}</strong></p>`,idempotencyKey:`admin:${item.id}`});
        await store.markOutbox(item.id,'processed');processed++;
      }catch(error){logger.error(JSON.stringify({event:'notification_delivery_failed',orderId:item.orderId,kind:item.kind,code:String(error?.message||'email_error')}));}
    }
    return {configured:true,processed};
  }
  return {configured,flush};
}
