import {readConfig} from './config.js';
import {products} from './products.js';
import {openStore} from './store.js';
import {createPostgresStore} from './postgres-store.js';
import {createGateway} from './services/mercadopago.js';
import {createApp} from './app.js';
import {createShipping,createShippingProvider} from './services/shipping.js';

const baseConfig=readConfig(process.env);
const hasSharedDatabase=Boolean(baseConfig.databaseUrl);
const config={...baseConfig,trustProxy:'loopback',durableStorage:hasSharedDatabase};
const store=hasSharedDatabase?createPostgresStore(baseConfig.databaseUrl):openStore('/tmp/dobroes-shop.sqlite');
const gateway=createGateway({...config,accessToken:config.mode==='disabled'?'':config.accessToken});
const shipping=createShipping(store,createShippingProvider());
export default createApp({config,catalog:products,store,gateway,shipping});
