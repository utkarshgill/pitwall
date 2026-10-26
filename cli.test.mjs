import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync,spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';

const cli=fileURLToPath(new URL('./cli.js',import.meta.url));
const event={id:'e1',event:'Build finished',distinct_id:'runner-1',occurred_at:'2026-01-01T00:00:00Z',properties:{label:'café'}};
const line=JSON.stringify(event)+'\n';
const run=(args,input='')=>spawnSync(process.execPath,[cli,...args],{input,encoding:'utf8',timeout:5000});
test('the CLI reads files and stdin with the same event records',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pitwall-cli-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=join(directory,'events.jsonl');await writeFile(file,line+line);
  for (const result of [run(['events'],line+line),run(['events','-'],line+line),run(['events',file])]) {
    assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');assert.equal(result.stdout,line+line);
  }
});
test('the CLI distinguishes bad arguments, bad input and a missing file',()=>{
  assert.match(run(['--help']).stdout,/Usage:/);
  for (const [args,input,message] of [[['unknown'],'',/Usage:/],[['events'],'{}\n',/Line 1:/],[['events','/missing/pitwall.jsonl'],'',/ENOENT/]]) {
    const result=run(args,input);assert.equal(result.status,1);assert.match(result.stderr,message);
  }
});
test('a consumer closing the pipe exits cleanly', {timeout:10000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pitwall-pipe-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=join(directory,'events.jsonl');
  await writeFile(file,Array.from({length:300},(_,i)=>JSON.stringify({...event,id:String(i),properties:{text:'x'.repeat(4096)}})).join('\n'));
  const query=JSON.stringify({event:event.event,from:'2025-12-31T00:00:00Z',to:'2026-01-02T00:00:00Z'});
  for (const args of [['events',file],['report',file,'--query',query]]) {
    const child=spawn(process.execPath,[cli,...args],{stdio:['ignore','pipe','pipe']});
    t.after(()=>child.kill());let error='';child.stderr.on('data',chunk=>error+=chunk);
    child.stdout.once('data',()=>child.stdout.destroy());
    const [code]=await once(child,'close');assert.equal(code,0,error);assert.equal(error,'');
  }
});

test('the report command uses the same SQL engine without an application server',()=>{
  const query={event:'Build finished',from:'2025-12-31T00:00:00Z',to:'2026-01-02T00:00:00Z'};
  const result=run(['report','--query',JSON.stringify(query)],line);
  assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);
  assert.equal(report.insight.total,1);assert.equal(report.insight.people,1);assert.equal(report.events[0].id,event.id);
  assert.equal(run(['report'],line).status,1);
});
