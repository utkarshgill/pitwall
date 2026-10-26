import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('identity requires one unambiguous supplied actor and grants no public access',async()=>{
  const db=await PGlite.create();
  try {
    await db.exec(await readFile(new URL('./identity.sql',import.meta.url),'utf8'));
    for (const [links,expected] of [[null,null],[[],null],[[null],null],[['user-a',null,'user-a'],'user-a'],[['user-a','user-b'],null]])
      assert.equal((await db.query('select pitwall.identity($1) as actor',[links])).rows[0].actor,expected);
    await db.exec('create role reader');
    assert.equal((await db.query("select has_function_privilege('reader','pitwall.identity(text[])','execute') as allowed")).rows[0].allowed,false);
  } finally {await db.close();}
});
