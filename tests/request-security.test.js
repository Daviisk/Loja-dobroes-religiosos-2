import test from 'node:test';
import assert from 'node:assert/strict';
import {trackingRequestError} from '../backend/request-security.js';
const base='https://loja.example';
test('cancel never accepts GET or HEAD',()=>{
 for(const method of ['GET','HEAD','OPTIONS'])assert.equal(trackingRequestError({method,url:'/?action=cancel',headers:{}},base).status,405);
});
test('cancel requires exact same origin',()=>{
 for(const origin of [undefined,'null','https://evil.example',base+'.evil.example'])assert.equal(trackingRequestError({method:'POST',url:'/?action=cancel',headers:{origin}},base).status,403);
 assert.equal(trackingRequestError({method:'POST',url:'/?action=cancel',headers:{origin:base,'sec-fetch-site':'cross-site'}},base).status,403);
 assert.equal(trackingRequestError({method:'POST',url:'/?action=cancel',headers:{origin:base}},base),null);
});
test('tracking reads remain accessible but cannot be POSTed',()=>{
 for(const action of ['track','link']){
  assert.equal(trackingRequestError({method:'GET',url:'/?action='+action,headers:{}},base),null);
  assert.equal(trackingRequestError({method:'POST',url:'/?action='+action,headers:{}},base).status,405);
 }
});
