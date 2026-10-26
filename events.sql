create schema if not exists pitwall;
revoke all on schema pitwall from public;

create table if not exists pitwall.events (
  id text primary key check (btrim(id) <> ''),
  event text not null check (btrim(event) <> ''),
  distinct_id text not null check (btrim(distinct_id) <> ''),
  occurred_at timestamptz not null check (isfinite(occurred_at)),
  received_at timestamptz not null default clock_timestamp(),
  properties jsonb not null default '{}' check (jsonb_typeof(properties) = 'object')
);
revoke all on pitwall.events from public;

create or replace function pitwall.append(
  event_id text, event_name text, actor_id text, event_time timestamptz, event_properties jsonb default '{}'
) returns boolean language plpgsql set search_path = '' as $$
declare added integer;
begin
  insert into pitwall.events(id,event,distinct_id,occurred_at,properties)
    values(event_id,event_name,actor_id,event_time,event_properties) on conflict(id) do nothing;
  get diagnostics added = row_count;
  if added = 0 and not exists (
    select 1 from pitwall.events e where e.id = event_id and e.event = event_name
      and e.distinct_id = actor_id and e.occurred_at = event_time and e.properties = event_properties
  ) then raise exception 'Event ID reused with different facts'; end if;
  return added = 1;
end;
$$;
revoke all on function pitwall.append(text,text,text,timestamptz,jsonb) from public;
