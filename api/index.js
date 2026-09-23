import app from '../backend/vercel-app.js';

// Requests are routed to this single Function so checkout/session state can share
// the same app instance. Preserve every original query parameter, removing only
// Vercel's internal `path` rewrite key.
export default (req,res)=>{
  const url=new URL(req.url,'https://api.local');
  const routed=(url.searchParams.get('path')||url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+/,'');
  const publicRoutes=new Set(['sucesso','sucesso.html','js/cart.js']);
  url.searchParams.delete('path');
  const query=url.searchParams.toString();
  const pathname=publicRoutes.has(routed)?'/'+routed:'/api/'+routed;
  req.url=pathname+(query?'?'+query:'');
  return app(req,res);
};
