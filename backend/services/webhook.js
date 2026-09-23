import {WebhookSignatureValidator,InvalidWebhookSignatureError} from 'mercadopago';
import {fail} from '../validation.js';

function diagnostic(stage,{id='',requestId='',signature='',secret='',sdkError=''}={}){
  console.error(JSON.stringify({event:'mercadopago_webhook_diagnostic',stage,type:'payment',hasSecret:Boolean(secret),hasSignature:Boolean(signature),hasRequestId:Boolean(requestId),dataId:id||null,validator:'mercadopago-sdk',sdkError:sdkError||null}));
}

export function authenticateWebhook(req,secret){
  if(!secret){diagnostic('missing_secret',{secret});fail(503,'webhook_not_configured','Webhook não configurado.');}
  const url=new URL(req.originalUrl,'http://internal');
  const queryIds=url.searchParams.getAll('data.id');
  const body=req.body;
  const bodyId=body&&typeof body.data==='object'&&body.data!==null?String(body.data.id||''):'';
  const queryId=queryIds.length===1?queryIds[0]:'';
  const type=String(body?.type||url.searchParams.get('type')||'');
  const requestId=req.get('x-request-id')||'';
  const signature=req.get('x-signature')||'';

  if(queryIds.length!==1||type!=='payment'||!/^\d{6,32}$/.test(queryId)||requestId.length<8||requestId.length>256||!signature||signature.length>512){
    diagnostic('invalid_notification_headers',{id:queryId,requestId,signature,secret});
    fail(400,'invalid_notification','Notificação inválida.');
  }
  if(!body||body.type!=='payment'||typeof body.data!=='object'||body.data===null||bodyId!==queryId){
    diagnostic('invalid_notification_body',{id:queryId,requestId,signature,secret});
    fail(400,'invalid_notification','Notificação inválida.');
  }

  try{
    WebhookSignatureValidator.validate({xSignature:signature,xRequestId:requestId,dataId:queryId,secret:secret.trim()});
  }catch(error){
    const invalid=error instanceof InvalidWebhookSignatureError||error?.name==='InvalidWebhookSignatureError';
    diagnostic(invalid?'sdk_signature_mismatch':'sdk_validator_error',{id:queryId,requestId,signature,secret,sdkError:error?.name||'unknown'});
    if(invalid)fail(401,'invalid_signature','Assinatura inválida.');
    throw error;
  }
  diagnostic('validated',{id:queryId,requestId,signature,secret});
  return queryId;
}
