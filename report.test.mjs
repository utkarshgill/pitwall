import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

let db;
before(async()=>{db=await PGlite.create();await db.exec(await readFile(new URL('./report.sql',import.meta.url),'utf8'));});
after(()=>db.close());
const options={from:'2025-12-31T00:00:00Z',to:'2026-01-04T00:00:00Z',event:'Build finished'};
const event=(id,name='Build finished',actor='runner-a',second=1,properties={})=>({id,event:name,distinct_id:actor,
  occurred_at:new Date(Date.UTC(2026,0,1,0,0,second)).toISOString(),properties});
const report=async(records,query={})=>(await db.query('select pitwall.report($1,$2) as data',[records,{...options,...query}])).rows[0].data;

test('counts, people and property sums use the same supplied period',async()=>{
  const records=[event('a',undefined,undefined,1,{duration:10}),event('b',undefined,undefined,86401,{duration:20}),
    event('c',undefined,'runner-b',2,{duration:30}),event('d','Build started'),event('future',undefined,undefined,400000)];
  const result=await report(records,{sums:{total_duration:'duration'}});
  assert.equal(result.insight.total,3);assert.equal(result.insight.people,2);assert.equal(result.insight.sums.total_duration,60);
  assert.equal(result.insight.series.reduce((n,s)=>n+s.count,0),3);
  assert.equal(result.insight.series.reduce((n,s)=>n+s.sums.total_duration,0),60);
  assert.equal(result.event_counts['Build started'],1);assert.equal(result.funnel,null);
  assert.ok(result.events.every(e=>e.event==='Build finished'));
  const unique=await report(records,{measure:'people'});
  assert.equal(unique.insight.people,2);assert.equal(unique.insight.series.reduce((n,s)=>n+s.count,0),3);
  const profile=await report(records,{person:'runner-a'});
  assert.equal(profile.people.length,1);assert.equal(profile.events.length,3);
  assert.deepEqual((await report([])).insight.sums,{});
});

test('equal times retain distinct occurrences and repeating a funnel step requires another event',async()=>{
  const query={event:'Tick',steps:['Tick','Tick']};
  assert.deepEqual((await report([event('a','Tick')],query)).funnel.stages.map(s=>s.count),[1,0]);
  const result=await report([event('c','Tick'),event('a','Tick'),event('b','Tick')],query);
  assert.deepEqual(result.funnel.stages.map(s=>s.count),[1,1]);assert.equal(result.funnel.cohort,1);
  assert.equal(result.funnel.matched_events,2);assert.equal(result.funnel.elapsed_ms,0);
});

test('correlation and unlinked matching are explicit query policies',async()=>{
  const a={...event('a','Start',undefined,1),correlation:'job-a'},b={...event('b','Finish',undefined,2),correlation:'job-b'};
  const query={event:'Finish',steps:['Start','Finish'],correlate:true};
  assert.deepEqual((await report([a,b],query)).funnel.stages.map(s=>s.count),[1,0]);
  assert.equal((await report([a,b],{...query,correlate:false})).funnel.stages.at(-1).count,1);
  const unlinked=event('c','Start',undefined,0);
  assert.equal((await report([unlinked,b],query)).funnel.stages.at(-1).count,0);
  assert.equal((await report([unlinked,b],{...query,allow_unlinked:true})).funnel.stages.at(-1).count,1);
  const later={...event('d','Start',undefined,3),correlation:'job-c'},finish={...event('e','Finish',undefined,4),correlation:'job-c'};
  const result=await report([a,b,later,finish],query);
  assert.equal(result.funnel.stages.at(-1).count,1);assert.equal(result.funnel.outside.length,1);
  assert.equal(result.funnel.members[0].elapsed_ms,1000);
});

test('timing, profile selection and hidden event names are supplied by the caller',async()=>{
  const records=[event('a',undefined,undefined,1,{client:'terminal'}),event('b','Activity',undefined,2,{step:'compile',ms:1200}),
    event('c',undefined,undefined,3,{status:'ok'})];
  const result=await report(records,{profile_property:'client',hidden_events:['Activity'],timing:{event:'Activity',step:'step',duration:'ms'}});
  assert.deepEqual(result.people[0].active_ms,{compile:1200});assert.equal(result.people[0].profile.id,'a');
  assert.equal(result.event_counts.Activity,undefined);assert.equal(result.events.length,2);
});

test('daily buckets use the requested timezone',async()=>{
  const records=[{...event('a'),occurred_at:'2026-01-01T22:00:00Z'}];
  const utc=await report(records),india=await report(records,{timezone:'Asia/Kolkata'});
  assert.equal(utc.insight.series.find(s=>s.count).date,'2026-01-01');
  assert.equal(india.insight.series.find(s=>s.count).date,'2026-01-02');
});

test('display limits do not truncate counts and the engine needs no stored tables',async()=>{
  const result=await report(Array.from({length:205},(_,i)=>event(String(i))));
  assert.equal(result.insight.total,205);assert.equal(result.events.length,200);
  assert.equal((await db.query("select count(*)::integer as n from pg_tables where schemaname='pitwall'")).rows[0].n,0);
});

test('malformed queries, incomplete records and duplicate IDs fail instead of returning misleading counts',async()=>{
  for (const query of [{from:null},{to:options.from},{event:''},{measure:'wrong'},{steps:['One']},{sums:[]}])
    await assert.rejects(report([],query));
  for (const records of [[{}],[event('a'),event('a')],[{...event('a'),properties:null}]])
    await assert.rejects(report(records),/event records/);
  await db.exec('create role reader');
  assert.equal((await db.query("select has_function_privilege('reader','pitwall.report(jsonb,jsonb)','execute') as allowed")).rows[0].allowed,false);
});
