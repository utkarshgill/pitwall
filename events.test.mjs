import assert from 'node:assert/strict';
import {before, beforeEach, after, test} from 'node:test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';

const schema = await readFile(new URL('./events.sql',import.meta.url),'utf8');
const event = {id:'e1',event:'Build finished',distinct_id:'runner-1',occurred_at:'2026-01-01T00:00:00Z',properties:{ok:true,duration_ms:12}};
let db;
before(async()=>{db=await PGlite.create();await db.exec(schema);});
beforeEach(()=>db.exec('truncate pitwall.events'));
after(()=>db.close());
const append = async (patch={}) => {
  const e={...event,...patch};
  return (await db.query('select pitwall.append($1,$2,$3,$4,$5) as inserted',
    [e.id,e.event,e.distinct_id,e.occurred_at,e.properties])).rows[0].inserted;
};
const rows = async () => (await db.query('select * from pitwall.events order by id')).rows;

test('append stores the supplied event facts and a separate receipt time',async()=>{
  assert.equal(await append(),true);
  const [stored]=await rows();
  assert.equal(stored.id,event.id);assert.equal(stored.event,event.event);
  assert.equal(stored.distinct_id,event.distinct_id);assert.deepEqual(stored.properties,event.properties);
  assert.equal(stored.occurred_at.toISOString(),'2026-01-01T00:00:00.000Z');
  assert.ok(stored.received_at>stored.occurred_at);
});

test('retrying identical facts preserves one row and its receipt time',async()=>{
  await append();const original=await rows();
  assert.equal(await append({properties:{duration_ms:12,ok:true}}),false);
  assert.deepEqual(await rows(),original);
});

test('reusing an ID for different facts fails without rewriting the event',async()=>{
  await append();const original=await rows();
  for (const patch of [{event:'Build started'},{distinct_id:'runner-2'},{occurred_at:'2026-01-02T00:00:00Z'},{properties:{ok:false}}])
    await assert.rejects(append(patch),/Event ID reused/);
  assert.deepEqual(await rows(),original);
});

test('distinct event IDs preserve repeated actions at the same time',async()=>{
  await append();await append({id:'e2'});assert.equal((await rows()).length,2);
});

test('invalid facts cannot enter the store',async()=>{
  for (const patch of [{id:''},{event:' '},{distinct_id:null},{occurred_at:null},{occurred_at:'infinity'},{properties:[]},{properties:null}])
    await assert.rejects(append(patch));
  assert.equal((await rows()).length,0);
});

test('reapplying the schema preserves accepted events',async()=>{
  await append();const original=await rows();await db.exec(schema);assert.deepEqual(await rows(),original);
});

test('the store and append operation are private by default',async()=>{
  await db.exec('create role reader');
  await assert.rejects(db.transaction(async tx=>{
    await tx.exec('set local role reader');await tx.query('select * from pitwall.events');
  }),/permission denied/);
  assert.equal((await db.query("select has_function_privilege('reader','pitwall.append(text,text,text,timestamptz,jsonb)','EXECUTE') as allowed")).rows[0].allowed,false);
});

test('accepted events survive closing and reopening a file-backed database',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pitwall-'));
  let disk;
  try {
    disk=await PGlite.create(directory);await disk.exec(schema);
    await disk.query('select pitwall.append($1,$2,$3,$4,$5)',Object.values(event));
    const original=(await disk.query('select * from pitwall.events')).rows;
    await disk.close();disk=null;
    disk=await PGlite.create(directory);
    assert.deepEqual((await disk.query('select * from pitwall.events')).rows,original);
  } finally {await disk?.close();await rm(directory,{recursive:true,force:true});}
});
