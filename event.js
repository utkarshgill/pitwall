export function validateEvent(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('Expected an event object.');
  for (const field of ['id','event','distinct_id','occurred_at'])
    if (typeof record[field] !== 'string' || !record[field].trim()) throw new TypeError(`Event requires ${field}.`);
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(record.occurred_at) || !Number.isFinite(Date.parse(record.occurred_at)))
    throw new TypeError('Event requires an occurrence time with a timezone.');
  if (!record.properties || typeof record.properties !== 'object' || Array.isArray(record.properties))
    throw new TypeError('Event properties must be an object.');
  return record;
}
