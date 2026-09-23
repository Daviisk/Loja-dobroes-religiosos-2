import {readConfig} from './config.js';
import {products} from './products.js';
import {openStore} from './store.js';
import {createGateway} from './services/mercadopago.js';
import {createApp} from './app.js';
import {createShipping,createShippingProvider} from './services/shipping.js';

// Vercel's bundle is read-only, but /tmp survives warm invocations of the same
// Function instance. This is a reliability improvement over pure in-memory
// storage; a shared external database is still required before high-volume use
// because separate serverless instances do not share /tmp.
const config={...readConfig(process.env),trustProxy:'loopback'};
const store=openStore('/tmp/dobroes-shop.sqlite');
const gateway=createGateway({...config,accessToken:config.mode==='disabled'?'':config.accessToken});
const shipping=createShipping(store,createShippingProvider());
export default createApp({config,catalog:products,store,gateway,shipping});
