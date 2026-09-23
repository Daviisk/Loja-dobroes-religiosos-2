(()=>{
 'use strict';
 const $=s=>document.querySelector(s),cash=c=>(Number(c||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),date=v=>v?new Date(v).toLocaleString('pt-BR'):'—';
 const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const labels={pending:'Aguardando',processing:'Processando',paid:'Pago',cancelled:'Cancelado',refunded:'Reembolsado',partially_refunded:'Reembolso parcial',failed:'Falhou',in_mediation:'Mediação',charged_back:'Chargeback',awaiting_payment:'Aguardando pagamento',preparing:'Em preparação',shipped:'Enviado',delivered:'Entregue',hold:'Em análise'};
 const api=async(path,options={})=>{const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,signal:options.signal||AbortSignal.timeout(15000)});let d=null;try{d=await r.json();}catch{}if(!r.ok)throw Error(d?.message||'Não foi possível concluir.');return d;};
 const loginView=$('#login-view'),appView=$('#app-view'),ordersView=$('#orders-view'),customersView=$('#customers-view');
 const panelMessage=text=>{$('#panel-message').textContent=text||'';};
 function showApp(){loginView.hidden=true;appView.hidden=false;loadOrders();}
 function showLogin(message=''){if($('#order-dialog').open)$('#order-dialog').close();appView.hidden=true;loginView.hidden=false;$('#login-message').textContent=message;}
 async function session(){try{const s=await api('/api/admin/session');if(s.authenticated)showApp();else showLogin(s.configured?'':'Configure ADMIN_PASSWORD e ADMIN_SESSION_SECRET no servidor.');}catch{showLogin('Não foi possível abrir o painel.');}}
 $('#login-form').addEventListener('submit',async e=>{e.preventDefault();$('#login-message').textContent='Entrando…';try{await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('#admin-password').value})});$('#admin-password').value='';showApp();}catch(err){showLogin(err.message);}});
 $('#logout').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch{}showLogin();});
 function badge(status){const cls=String(status||'').replace(/[^a-z_]/g,'');return `<span class="badge ${cls}">${esc(labels[status]||status||'—')}</span>`;}
 function copyButton(value,label){return value?`<button type="button" class="copy-mini" data-copy="${encodeURIComponent(String(value))}">Copiar ${esc(label)}</button>`:'';}
 async function copyText(value,button){
  try{
   if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
   else{const area=document.createElement('textarea');area.value=value;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove();}
   const old=button.textContent;button.textContent='Copiado';setTimeout(()=>{button.textContent=old;},1200);
  }catch{panelMessage('Não foi possível copiar automaticamente.');}
 }
 function progress(order){
  const rank={awaiting_payment:0,paid:1,preparing:2,shipped:3,delivered:4};
  const stages=[['Pedido criado','awaiting_payment'],['Pagamento','paid'],['Preparação','preparing'],['Enviado','shipped'],['Entregue','delivered']],current=rank[order.fulfillmentStatus]??0,history=Array.isArray(order.fulfillmentHistory)?order.fulfillmentHistory:[];
  const historyDate=status=>history.findLast?.(item=>item?.to===status)?.at||[...history].reverse().find(item=>item?.to===status)?.at||'';
  const steps=stages.map(([name,status],index)=>{const when=historyDate(status)||(status==='awaiting_payment'?order.createdAt:'');return `<li class="${index<current?'done':index===current?'current':''}"><span>${index+1}</span><strong>${name}</strong>${when?`<small>${esc(date(when))}</small>`:''}</li>`;}).join('');
  const warning=order.fulfillmentStatus==='hold'?'<p class="progress-warning">Pedido em análise. Confira o pagamento antes de continuar a expedição.</p>':order.fulfillmentStatus==='cancelled'?'<p class="progress-warning">Pedido cancelado.</p>':'';
  return `<div class="progress-head"><strong>Andamento do pedido</strong><span>${esc(labels[order.fulfillmentStatus]||order.fulfillmentStatus)}</span></div><ol class="order-progress">${steps}</ol>${warning}`;
 }
 function addressText(a={}){return [a.street&&`${a.street}, ${a.number||'s/n'}${a.complement?' · '+a.complement:''}`,a.district&&`${a.district} · ${a.city||''}/${a.state||''}`,a.cep&&`CEP ${a.cep}`].filter(Boolean).join('\n');}
 async function loadOrders(){
  const q=$('#search').value.trim(),status=$('#payment-filter').value,fulfillment=$('#fulfillment-filter').value,from=$('#date-from').value,to=$('#date-to').value;
  const params=new URLSearchParams({q,status,fulfillment,from,to,limit:'300'});panelMessage('Atualizando pedidos…');
  try{
   const data=await api('/api/admin/orders?'+params);
   $('#stat-total').textContent=data.summary.total;$('#stat-paid').textContent=data.summary.paid;$('#stat-awaiting-payment').textContent=data.summary.awaitingPayment;$('#stat-awaiting-shipment').textContent=data.summary.awaitingShipment;$('#stat-preparing').textContent=data.summary.preparing;$('#stat-shipped').textContent=data.summary.shipped;$('#stat-revenue').textContent=cash(data.summary.revenuePaid);$('#stat-ticket').textContent=cash(data.summary.ticketAverage);
   const body=$('#orders-body');body.replaceChildren();
   for(const o of data.orders){const tr=document.createElement('tr'),customer=o.customer||{};tr.innerHTML=`<td><strong>#${esc(o.orderCode)}</strong><span class="muted">${esc(o.paymentId||'sem pagamento')}</span></td><td>${esc(date(o.createdAt))}</td><td><strong>${esc(customer.name||'—')}</strong><span class="muted">${esc(customer.phone||'')}<br>${esc(customer.email||'')}</span></td><td>${(o.items||[]).reduce((n,i)=>n+Number(i.quantity||0),0)}</td><td><strong>${cash(o.total)}</strong></td><td>${badge(o.status)}</td><td>${badge(o.fulfillmentStatus)}</td><td><button class="open-order" data-id="${esc(o.orderId)}">Abrir</button></td>`;body.append(tr);}
   $('#orders-empty').hidden=data.orders.length>0;body.querySelectorAll('.open-order').forEach(b=>b.addEventListener('click',()=>openOrder(b.dataset.id)));panelMessage(`Atualizado às ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}.`);
  }catch(err){panelMessage(err.message);if(/login|painel/i.test(err.message))showLogin(err.message);}
 }
 async function loadCustomers(){
  panelMessage('Atualizando clientes…');
  try{const data=await api('/api/admin/customers?'+new URLSearchParams({q:$('#customer-search').value.trim(),limit:'300'}));const body=$('#customers-body');body.replaceChildren();for(const c of data.customers){const tr=document.createElement('tr');tr.innerHTML=`<td><strong>${esc(c.name)}</strong><span class="muted">${esc(c.customerId)}</span></td><td>${esc(c.phone)}<br><span class="muted">${esc(c.email)}</span></td><td>${Number(c.orders||0)}</td><td>${cash(c.totalSpent)}</td><td>${esc(date(c.lastOrderAt))}</td>`;body.append(tr);}$('#customers-empty').hidden=data.customers.length>0;panelMessage(`Atualizado às ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}.`);}catch(err){panelMessage(err.message);if(/login|painel/i.test(err.message))showLogin(err.message);}
 }
 async function openOrder(id){
  try{
   const o=await api('/api/admin/orders/'+encodeURIComponent(id));$('#dialog-title').textContent=`Pedido #${o.orderCode}`;
   const customer=o.customer||{},a=o.address||{},s=o.shipping||{},address=addressText(a),items=(o.items||[]).map(i=>`<li>${Number(i.quantity||0)} × ${esc(i.name)} — ${cash(i.subtotal)}</li>`).join('');
   $('#order-detail').innerHTML=`<section id="order-progress-wrap" class="progress-card">${progress(o)}</section><div class="detail-grid"><section class="detail-card"><h3>Cliente</h3><p><strong>${esc(customer.name||'—')}</strong></p><p>${esc(customer.phone||'—')}<br>${esc(customer.email||'—')}</p><div class="copy-row">${copyButton(customer.phone,'telefone')}${copyButton(customer.email,'e-mail')}</div><p class="muted">Cliente: ${esc(customer.customerId||'—')}</p></section><section class="detail-card"><h3>Pagamento</h3><p>${badge(o.status)}</p><p><strong>${cash(o.total)}</strong></p><p class="muted">Payment ID: ${esc(o.paymentId||'—')}<br>${esc(o.providerStatusDetail||'')}</p><div class="copy-row">${copyButton(o.paymentId,'Payment ID')}${copyButton(o.orderCode,'pedido')}</div></section><section class="detail-card"><h3>Entrega</h3><p>${esc(address).replaceAll('\n','<br>')||'—'}</p><p>${esc(s.name||'—')} · ${esc(s.days||'—')} dia(s)</p><div class="copy-row">${copyButton(address,'endereço')}${copyButton(o.trackingCode,'rastreio')}</div></section><section class="detail-card"><h3>Itens</h3><ul>${items}</ul><p>Produtos: ${cash(o.productsTotal)}<br>Frete: ${cash(s.priceCents)}<br><strong>Total: ${cash(o.total)}</strong></p></section></div><form id="fulfillment-form" class="detail-form"><label>Status da entrega<select id="fulfillment-status"><option value="awaiting_payment">Aguardando pagamento</option><option value="paid">Pago</option><option value="preparing">Em preparação</option><option value="shipped">Enviado</option><option value="delivered">Entregue</option><option value="hold">Em análise</option><option value="cancelled">Cancelado</option></select></label><label>Código de rastreio<input id="tracking-code" maxlength="100" value="${esc(o.trackingCode||'')}"></label><label>Observações<textarea id="admin-notes" maxlength="1000"></textarea></label><button type="submit">Salvar alterações</button><p id="detail-message" class="message" role="status"></p></form>`;
   $('#fulfillment-status').value=o.fulfillmentStatus||'awaiting_payment';$('#admin-notes').value=o.adminNotes||'';
   $('#fulfillment-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;$('#detail-message').textContent='Salvando…';try{const saved=await api('/api/admin/orders/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fulfillmentStatus:$('#fulfillment-status').value,trackingCode:$('#tracking-code').value,adminNotes:$('#admin-notes').value})});$('#detail-message').textContent='Alterações salvas.';$('#order-progress-wrap').innerHTML=progress(saved);loadOrders();}catch(err){$('#detail-message').textContent=err.message;}finally{button.disabled=false;}});
   $('#order-dialog').showModal();
  }catch(err){panelMessage(err.message);if(/login|painel/i.test(err.message))showLogin(err.message);}
 }
 $('#order-detail').addEventListener('click',e=>{const button=e.target.closest('[data-copy]');if(button)copyText(decodeURIComponent(button.dataset.copy),button);});
 $('#dialog-close').addEventListener('click',()=>$('#order-dialog').close());$('#refresh').addEventListener('click',()=>ordersView.hidden?loadCustomers():loadOrders());
 let timer;$('#search').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(loadOrders,250);});for(const id of ['payment-filter','fulfillment-filter','date-from','date-to'])$('#'+id).addEventListener('change',loadOrders);$('#customer-search').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(loadCustomers,250);});
 $('#clear-filters').addEventListener('click',()=>{for(const id of ['search','payment-filter','fulfillment-filter','date-from','date-to'])$('#'+id).value='';loadOrders();});
 document.querySelectorAll('.nav').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n===btn));const customers=btn.dataset.view==='customers';ordersView.hidden=customers;customersView.hidden=!customers;$('#page-title').textContent=customers?'Clientes':'Pedidos';customers?loadCustomers():loadOrders();}));
 session();
})();
