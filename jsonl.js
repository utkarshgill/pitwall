import {createInterface} from 'node:readline';
import {validateEvent} from './event.js';

export async function* readEvents(input) {
  const lines=createInterface({input,crlfDelay:Infinity});
  let number=0;
  try {
    for await (const line of lines) {
      number++;
      if (!line.trim()) continue;
      let event;
      try {event=validateEvent(JSON.parse(line));}
      catch (error) {throw new Error(`Line ${number}: ${error.message}`);}
      yield event;
    }
  } finally {lines.close();input.destroy();}
}
