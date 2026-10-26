#!/usr/bin/env node
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {readEvents} from './jsonl.js';

const usage='Usage: pitwall events [FILE|-]\nRead newline-delimited events from a file or stdin. Write JSON lines to stdout.';
const [command,file='-',...extra]=process.argv.slice(2);
try {
  if (!command || command==='--help' || command==='-h') console.log(usage);
  else {
    if (command!=='events' || extra.length) throw new Error(usage);
    await pipeline(readEvents(file==='-' ? process.stdin : createReadStream(file)),async function* (events) {
      for await (const event of events) yield JSON.stringify(event)+'\n';
    },process.stdout);
  }
} catch (error) {
  if (error.code!=='EPIPE') {console.error(error.message);process.exitCode=1;}
}
