import test from 'node:test';
import assert from 'node:assert/strict';
import {readConfig} from '../backend/config.js';

test('Vercel production boots with the trusted production domain when APP_URL is absent',()=>{
 const config=readConfig({NODE_ENV:'production',VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_PRODUCTION_URL:'shop.example.com',VERCEL_URL:'shop-123.vercel.app'});
 assert.equal(config.baseURL,'https://shop.example.com');
 assert.equal(config.mode,'disabled');
});
test('preview uses its deployment domain, and APP_URL has explicit priority',()=>{
 const env={NODE_ENV:'production',VERCEL:'1',VERCEL_ENV:'preview',VERCEL_PROJECT_PRODUCTION_URL:'shop.example.com',VERCEL_URL:'shop-123.vercel.app'};
 assert.equal(readConfig(env).baseURL,'https://shop-123.vercel.app');
 assert.equal(readConfig({...env,APP_URL:'https://custom.example.com'}).baseURL,'https://custom.example.com');
});
test('missing HTTPS configuration outside Vercel and malformed domains still fail closed',()=>{
 assert.throws(()=>readConfig({NODE_ENV:'production'}),/HTTPS/);
 assert.throws(()=>readConfig({NODE_ENV:'production',VERCEL:'1',VERCEL_URL:'evil.example/path'}),/inválido/);
 assert.throws(()=>readConfig({NODE_ENV:'production',VERCEL:'1',VERCEL_URL:'safe.vercel.app',APP_URL:'http://localhost:3000'}),/HTTPS/);
 assert.equal(readConfig({}).baseURL,'http://localhost:3000');
});
