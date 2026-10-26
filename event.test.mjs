import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateEvent} from './event.js';

const event={id:'e1',event:'Build finished',distinct_id:'runner-1',occurred_at:'2026-01-01T00:00:00Z',properties:{ok:true}};
test('the event boundary preserves facts and rejects incomplete records',()=>{
  assert.equal(validateEvent(event),event);
  for (const value of [null,[],{},...['id','event','distinct_id','occurred_at'].map(field=>({...event,[field]:' '})),
    {...event,occurred_at:'infinity'},{...event,occurred_at:'2026-01-01T00:00:00'},
    {...event,properties:null},{...event,properties:[]}]) assert.throws(()=>validateEvent(value),TypeError);
  assert.equal(validateEvent({...event,occurred_at:'2026-01-01T05:30:00+05:30'}).occurred_at,'2026-01-01T05:30:00+05:30');
});
