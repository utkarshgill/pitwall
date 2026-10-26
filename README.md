# Pitwall

Small, readable event analytics. The first brick is an event store.

An event has an ID, name, occurrence time, opaque actor/device ID, and JSON properties. Storage adds `received_at`. The actor ID is recorded as supplied; identity merging is a later decision.

[events.sql](events.sql) contains one PostgreSQL table and one append operation. Run the checks with Node.js 24 and pnpm; no Supabase project or running server is required:

```sh
pnpm install
pnpm test
pnpm demo
```

The tests run the SQL in PGlite, an embedded PostgreSQL. The demo appends one event, retries it, closes the database, reopens `.data`, and prints the stored row. To use an existing PostgreSQL database, install the same file with `psql "$DATABASE_URL" -f events.sql` as its owner.

```sql
select pitwall.append(
  'e1', 'Build finished', 'runner-1', '2026-01-01T00:00:00Z',
  '{"ok":true,"duration_ms":12}'
);
select * from pitwall.events where id = 'e1';
```

`append` returns true for a new event and false for an identical retry. A reused ID with different supplied facts raises an error. An omitted/null occurrence time uses the server's observation time on the first append; retries retain it. JSON object key order does not affect equality. Separate event IDs retain repeated actions, including actions with equal timestamps. The receipt time stays fixed on retries.

This is one private dataset, accessible to its database owner. Transport, project credentials, identity resolution and reports will be defined as separate, tested steps.

## Reading behind this brick

- [Mixpanel event ingestion](https://docs.mixpanel.com/reference/import-events): event name, occurrence time, identity and retry identifiers are distinct inputs.
- [Segment common fields](https://www.twilio.com/docs/segment/connections/spec/common): distinguishes message identity, actor identity and occurrence/receipt times.
- [Amplitude event ingestion](https://amplitude.com/docs/apis/analytics/http-v2): separates event identity from device/user identity.

Pitwall's ID conflict rule above is its own small contract. It is not a claim of compatibility with those APIs' deduplication or identity rules.
