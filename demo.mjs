import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const schema=await readFile(new URL('./events.sql',import.meta.url),'utf8');
const values=[randomUUID(),'Button Clicked','example-device',new Date().toISOString(),{button:'start'}];
const append='select pitwall.append($1,$2,$3,$4,$5) as inserted';
let db=await PGlite.create('.data');
await db.exec(schema);
const first=(await db.query(append,values)).rows[0].inserted;
const retry=(await db.query(append,values)).rows[0].inserted;
await db.close();
db=await PGlite.create('.data');
try {
  const [stored]=(await db.query('select * from pitwall.events where id=$1',[values[0]])).rows;
  console.log(JSON.stringify({first,retry,stored_after_reopen:stored},null,2));
} finally {await db.close();}
