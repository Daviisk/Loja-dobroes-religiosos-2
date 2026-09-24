import {resolve} from 'node:path';
export function readConfig(env=process.env){
  const production=env.NODE_ENV==='production';
  const port=Number(env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT inválida.');
  // Vercel provides trusted deployment domains without a protocol. Do not infer
  // the application's origin from a request Host header.
  const vercelHost=env.VERCEL==='1'
    ? (env.VERCEL_ENV==='preview'?env.VERCEL_URL:(env.VERCEL_PROJECT_PRODUCTION_URL||env.VERCEL_URL))
    : '';
  if(!env.APP_URL&&vercelHost&&!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(vercelHost))throw Error('Domínio da Vercel inválido.');
  const baseURL=env.APP_URL||(vercelHost?`https://${vercelHost}`:`http://localhost:${port}`);const u=new URL(baseURL);
  if(u.origin!==baseURL||u.username||u.password)throw Error('APP_URL deve conter somente a origem, sem barra final.');
  if(production&&u.protocol!=='https:')throw Error('Produção exige APP_URL HTTPS.');
  const mode=env.MERCADO_PAGO_MODE||'disabled';if(!['disabled','test','production'].includes(mode))throw Error('MERCADO_PAGO_MODE inválido.');
  if(mode==='production'&&!production)throw Error('Pagamentos reais exigem NODE_ENV=production.');
  const trustProxy=env.TRUST_PROXY||false;
  if(trustProxy==='true'||/^\d+$/.test(String(trustProxy)))throw Error('TRUST_PROXY deve ser IP/CIDR explícito ou loopback, nunca true ou número.');
  const adminPassword=env.ADMIN_PASSWORD||'',adminSessionSecret=env.ADMIN_SESSION_SECRET||'';
  const adminConfigured=adminPassword.length>=12&&adminSessionSecret.length>=32;
  const databaseUrl=String(env.DATABASE_URL||'').trim();
  if(databaseUrl){const db=new URL(databaseUrl);if(!['postgres:','postgresql:'].includes(db.protocol)||!db.hostname||!db.username||!db.password)throw Error('DATABASE_URL PostgreSQL inválida.');}
  return {production,port,baseURL,mode,trustProxy,accessToken:env.MERCADO_PAGO_ACCESS_TOKEN||'',publicKey:env.MERCADO_PAGO_PUBLIC_KEY||'',webhookSecret:env.WEBHOOK_SECRET||'',sellerId:env.MERCADO_PAGO_SELLER_ID||'',applicationId:env.MERCADO_PAGO_APPLICATION_ID||'',adminPassword,adminSessionSecret,adminConfigured,databaseUrl,databasePath:resolve(env.DATABASE_PATH||'backend/data/shop.sqlite'),frontendPath:resolve('frontend'),checkoutLimit:10,webhookLimit:120,sessionLimit:30};
}
