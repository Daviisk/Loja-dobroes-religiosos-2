import {WebhookSignatureValidator,InvalidWebhookSignatureError} from 'mercadopago';
import {fail} from '../validation.js';

function diagnostic(stage,{id='',type='',requestId='',signature='',secret='',ts='',sdkError='',variant=''}={}){
  console.error(JSON.stringify({event:'mercadopago_webhook_diagnostic',stage,type:type||null,hasSecret:Boolean(secret),hasSignature:Boolean(signature),hasRequestId:Boolean(requestId),dataId:id||null,timestampPresent:Boolean(ts),validator:'mercadopago-sdk',sdkError:sdkError||null,variant:variant||null}));
}

function validateSignature({signature,requestId,dataId,secret}){
  WebhookSignatureValidator.validate({xSignature:signature,xRequestId:requestId,dataId,secret:secret.trim()});
}

export function authenticateWebhook(req,secret,now=Date.now()){
  if(!secret){diagnostic('missing_secret',{secret});fail(503,'webhook_not_configured','Webhook não configurado.');}

  const url=new URL(req.originalUrl,'http://internal');
  const queryIds=url.searchParams.getAll('data.id');
  const body=req.body;
  const bodyId=body&&typeof body.data==='object'&&body.data!==null?String(body.data.id||''):'';
  const queryId=queryIds.length===1?queryIds[0]:'';
  const type=String(body?.type||url.searchParams.get('type')||'');
  const id=queryId||bodyId;
  const requestId=req.get('x-request-id')||'';
  const signature=req.get('x-signature')||'';
  const tsMatch=typeof signature==='string'?signature.match(/(?:^|,)\s*ts=(\d{10}|\d{13})(?:,|$)/):null;
  const ts=tsMatch?tsMatch[1]:'';
  const validId=type==='payment'?/^\d{6,32}$/.test(id):type==='order'?/^ORD[A-Z0-9]{10,64}$/.test(id):false;

  if(queryIds.length!==1||!validId||typeof requestId!=='string'||requestId.length<8||requestId.length>256||typeof signature!=='string'||signature.length>512||!ts){
    diagnostic('invalid_notification_headers',{id,type,requestId,signature,secret,ts});
    fail(400,'invalid_notification','Notificação inválida.');
  }
  if(!body||!['payment','order'].includes(body.type)||typeof body.data!=='object'||body.data===null||bodyId!==queryId||body.type!==type){
    diagnostic('invalid_notification_body',{id,type,requestId,signature,secret,ts});
    fail(400,'invalid_notification','Notificação inválida.');
  }

  const variants=type==='order'&&queryId!==queryId.toLowerCase()?[queryId,queryId.toLowerCase()]:[queryId];
  let lastError=null;
  for(const dataId of variants){
    try{
      validateSignature({signature,requestId,dataId,secret});
      const milliseconds=Number(ts)*(ts.length===10?1000:1);
      if(!Number.isFinite(milliseconds)||Math.abs(now-milliseconds)>300000){
        diagnostic('expired_timestamp',{id,type,requestId,signature,secret,ts,variant:dataId===queryId?'original-case':'lowercase'});
        fail(401,'expired_notification','Notificação fora da janela de validade.');
      }
      diagnostic('validated',{id,type,requestId,signature,secret,ts,variant:dataId===queryId?'original-case':'lowercase'});
      return {type,id};
    }catch(error){
      if(error?.code==='expired_notification')throw error;
      const invalid=error instanceof InvalidWebhookSignatureError||error?.name==='InvalidWebhookSignatureError';
      if(!invalid)throw error;
      lastError=error;
    }
  }

  diagnostic('sdk_signature_mismatch',{id,type,requestId,signature,secret,ts,sdkError:lastError?.name||'InvalidWebhookSignatureError',variant:variants.length>1?'original+lowercase':'original-case'});
  fail(401,'invalid_signature','Assinatura inválida.');
}
