import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPitwall} from './client.js';

function browser(t) {
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const document=Object.assign(new EventTarget(),{visibilityState:'visible'});
  const globals={document,window:new EventTarget(),localStorage:storage,sessionStorage:storage,innerWidth:390,
    navigator:{userAgent:'Mozilla/5.0 (Linux; Android 14; Mobile) Chrome/120',maxTouchPoints:0}};
  for (const [key,value] of Object.entries(globals)) {
    const original=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
    t.after(()=>original ? Object.defineProperty(globalThis,key,original) : delete globalThis[key]);
  }
  t.mock.timers.enable({apis:['Date','setInterval'],now:Date.UTC(2026,0,1)});
  t.mock.method(performance,'now',()=>Date.now());
  const events=[];let id=0;
  const client=createPitwall({send:event=>events.push(event),key:()=>`id-${++id}`,views:{screen:'Screen viewed'}});
  return {events,client,document,tick:ms=>t.mock.timers.tick(ms)};
}

test('capture emits portable event facts and preserves repeated actions',t=>{
  const {client,events}=browser(t);
  client.track('signed_in',{channel:'test'});client.track('signed_in',{channel:'test'});
  const [a,b]=events;
  assert.notEqual(a.id,b.id);assert.equal(a.distinct_id,b.distinct_id);
  assert.equal(a.occurred_at,'2026-01-01T00:00:00.000Z');assert.equal(a.received_at,undefined);
  assert.equal(a.event,'signed_in');assert.equal(a.properties.channel,'test');
  assert.equal(a.properties.session_id,b.properties.session_id);
  assert.equal(a.properties.device,'phone');assert.equal(a.properties.os,'Android');assert.equal(a.properties.browser,'Chrome');
});

test('foreground measurements exclude hidden time and parent/overlay overlap',t=>{
  const {client,events,document,tick}=browser(t);
  const sum=step=>events.filter(e=>e.properties.step===step).reduce((n,e)=>n+e.properties.duration_ms,0);
  let stopScreen=client.time('screen');tick(200);
  let stopDialog=client.time('dialog',{},1);tick(300);stopDialog();tick(200);stopScreen();
  assert.equal(sum('screen'),400);assert.equal(sum('dialog'),300);
  stopScreen=client.time('screen');tick(200);
  document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));tick(5000);
  document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));tick(200);stopScreen();
  assert.equal(sum('screen'),800);
  stopDialog=client.time('dialog',{},3);tick(100);
  stopScreen=client.time('screen');tick(100);stopScreen();tick(100);stopDialog();
  assert.equal(sum('dialog'),600);assert.equal(sum('screen'),800);
  assert.equal(events.filter(e=>e.event==='Screen viewed').length,3);
});

test('transport failure and disabled capture cannot break the host',async t=>{
  browser(t);
  assert.throws(()=>createPitwall({}),/send function/);
  for (const send of [()=>{throw Error('offline');},()=>Promise.reject(Error('offline'))]) {
    assert.doesNotThrow(()=>createPitwall({send}).track('Button Clicked'));
  }
  let sent=0;
  const client=createPitwall({enabled:false,send:()=>sent++});
  client.track('Button Clicked');assert.equal(client.time('screen'),undefined);assert.equal(sent,0);
  await Promise.resolve();
});

test('foreground observations are not clipped to a transport limit',t=>{
  const {client,events}=browser(t),stop=client.time('screen');
  t.mock.timers.setTime(Date.now()+600001);stop();
  assert.equal(events.find(e=>e.event==='step_time').properties.duration_ms,600001);
});
