# Pitwall

Small, readable event analytics. Current bricks: an event record, PostgreSQL storage, and a browser producer.

An event has an ID, name, occurrence time, opaque actor/device ID, and JSON properties. Storage adds `received_at`. The actor ID is recorded as supplied.

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

`append` returns true for a new event and false for an identical retry. The producer supplies occurrence time; storage adds receipt time. A reused ID with different facts raises an error. JSON object key order does not affect equality. Separate event IDs retain repeated actions, including actions with equal timestamps. The receipt time stays fixed on retries.

This is one private dataset, accessible to its database owner. The host controls credentials and which records a caller may read.

## Queries

Install `identity.sql` and `report.sql` in PostgreSQL, or load them into PGlite. Neither creates tables or reads application data. `pitwall.identity(text[])` returns the sole distinct non-null actor among supplied links; empty or conflicting links return null. The host must select links within the caller's authorised scope before resolving identity.

`pitwall.report(records, options)` accepts an array of event records and returns counts, daily series, people, timing and ordered conversion. It neither opens a connection nor resolves identity implicitly. Each record needs a unique ID and a resolved `distinct_id`. An optional `attributes` object passes through untouched; the engine does not interpret it.

```sql
select pitwall.report('[]', '{
  "event":"Build finished",
  "from":"2026-01-01T00:00:00Z", "to":"2026-02-01T00:00:00Z",
  "steps":["Build started","Build finished"],
  "sums":{"total_duration":"duration_ms"}
}');
```

The interval excludes `from` and includes `to`; daily buckets use `timezone` (UTC by default). `measure` selects event occurrences or unique people. Period uniques are not the sum of daily uniques. `sums` maps output names to numeric properties. `person` narrows all results to one actor. Counts cover the whole input interval; event samples stop at 200 rows and people/funnel samples at 100.

Funnel steps require separate occurrences in timestamp/ID order. Each person counts once, at their furthest stage. With `correlate:true`, the optional record `correlation` must agree across steps. Missing correlations may bridge steps only when `allow_unlinked:true` is explicitly supplied. This preserves independent attempts while preventing two known correlations from mixing. Conversion uses the supplied interval; there is no additional conversion window.

`timing` supplies the event name and property keys, for example `{"event":"Activity","step":"step","duration":"ms"}`. `hidden_events` omits chosen names from event lists and the name index without discarding timing observations. `profile_property` selects the latest record carrying a chosen metadata property. Person and funnel rows retain their first event, so the host can attach its own labels without teaching the engine business concepts.

## Command line

`node cli.js events events.jsonl` reads event records and writes JSON lines to stdout. Use `node cli.js events` to read stdin. Blank lines are ignored; records retain their IDs and properties. Invalid input fails with its line number. This command reads events; it does not deduplicate or store them.

The same streaming reader is available as `readEvents(input)` from `pitwall/jsonl`. It accepts a Node readable stream and closes it on completion, error or early exit. No database, web server or React dependency is needed to run the CLI.

To calculate a report locally, run `node cli.js report events.jsonl --query '{"event":"Build finished","from":"2026-01-01T00:00:00Z","to":"2026-02-01T00:00:00Z"}'`. This loads the same `report.sql` into an ephemeral PGlite database, prints JSON and closes it. PGlite is an optional dependency; installations that omit optional dependencies can still stream events or install the SQL in their own PostgreSQL. Reports load the supplied batch into memory; `events` remains streaming.

## Browser producer

```js
import {createPitwall} from 'pitwall/client';
const events=[];
const client=createPitwall({send:event=>events.push(event),namespace:'my-app'});
client.track('Button Clicked',{button:'start'});
```

`send` selects the transport. Each record carries `id`, `event`, `distinct_id`, `occurred_at` and `properties`. The producer persists an opaque browser ID and session ID under the namespace, and attaches coarse device/browser metadata. It preserves repeated actions and tolerates transport failure.

`client.time(step, properties, priority)` returns a stop function. It measures foreground time, excluding hidden tabs and overlapping parent/overlay intervals. `views` optionally maps steps to the host's event names. React consumers can use `usePitwallTime` from `pitwall/react`; React is an optional peer dependency.

## Reading behind this brick

- [Mixpanel event ingestion](https://docs.mixpanel.com/reference/import-events): event name, occurrence time, identity and retry identifiers are distinct inputs.
- [Segment common fields](https://www.twilio.com/docs/segment/connections/spec/common): distinguishes message identity, actor identity and occurrence/receipt times.
- [Amplitude event ingestion](https://amplitude.com/docs/apis/analytics/http-v2): separates event identity from device/user identity.

Pitwall's ID conflict rule above is its own small contract. It is not a claim of compatibility with those APIs' deduplication or identity rules.
