import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Readable} from 'node:stream';
import {readEvents} from './jsonl.js';

const event={id:'e1',event:'Build finished',distinct_id:'runner-1',occurred_at:'2026-01-01T00:00:00Z',properties:{ok:true}};
test('JSON lines survive chunk boundaries, blank lines and repeated records',async()=>{
  const text=JSON.stringify(event),source=Readable.from([text.slice(0,20),text.slice(20)+'\r','\n\r\n'+text]);
  assert.deepEqual(await Array.fromAsync(readEvents(source)),[event,event]);
  assert.equal(source.destroyed,true);
});
test('invalid records report their physical line and close the input',async()=>{
  for (const bad of ['{','{}']) {
    const input=Readable.from([JSON.stringify(event)+'\n\n'+bad]);
    await assert.rejects(Array.fromAsync(readEvents(input)),/Line 3:/);
    assert.equal(input.destroyed,true);
  }
});
