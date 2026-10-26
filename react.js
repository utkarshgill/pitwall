import {useEffect} from 'react';

export function usePitwallTime(client, step, context = {}, priority = 0) {
  const key = JSON.stringify(context);
  useEffect(() => client.time(step, JSON.parse(key), priority), [client, step, key, priority]);
}
