#!/usr/bin/env node
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {parseArgs} from 'node:util';
import {readEvents} from './jsonl.js';

const usage='Usage: pitwall events [FILE|-]\n       pitwall report [FILE|-] --query JSON\nRead newline-delimited events from a file or stdin. Write JSON to stdout.';
try {
  const {positionals,values}=parseArgs({allowPositionals:true,options:{query:{type:'string'},help:{type:'boolean',short:'h'}}});
  const [command,file='-',...extra]=positionals;
  if (!command || values.help) console.log(usage);
  else {
    if (!['events','report'].includes(command) || extra.length || command==='events'&&values.query) throw new Error(usage);
    if (command==='report'&&!values.query) throw new Error('report requires --query JSON');
    const records=readEvents(file==='-' ? process.stdin : createReadStream(file));
    if (command==='events') await pipeline(records,async function* (events) {
        for await (const event of events) yield JSON.stringify(event)+'\n';
      },process.stdout);
    else {
      const query=JSON.parse(values.query),events=await Array.fromAsync(records);
      const {PGlite}=await import('@electric-sql/pglite'),db=await PGlite.create();
      try {
        await db.exec(await readFile(new URL('./report.sql',import.meta.url),'utf8'));
        const result=(await db.query('select pitwall.report($1,$2) as result',[events,query])).rows[0].result;
        await pipeline([JSON.stringify(result)+'\n'],process.stdout);
      } finally {await db.close();}
    }
  }
} catch (error) {
  if (error.code!=='EPIPE') {console.error(error.message);process.exitCode=1;}
}
