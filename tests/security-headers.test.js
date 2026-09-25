import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
test('edge security headers apply before static and API routes without intercepting them',()=>{
 const rule=config.routes[0];assert.equal(rule.src,'/(.*)');assert.equal(rule.continue,true);assert.equal(rule.dest,undefined);
 assert.equal(rule.headers['X-Frame-Options'],'DENY');
 assert.equal(rule.headers['X-Content-Type-Options'],'nosniff');
 assert.equal(rule.headers['Referrer-Policy'],'no-referrer');
 assert.match(rule.headers['Content-Security-Policy'],/frame-ancestors 'none'/);
 assert.equal(rule.headers['Cross-Origin-Opener-Policy'],'same-origin-allow-popups');
 assert.equal(rule.headers['Cross-Origin-Embedder-Policy'],undefined);
 assert.ok(config.routes.some(r=>r.handle==='filesystem'));
 assert.ok(config.routes.some(r=>r.src==='/api/cancel-order'));
});
