create schema if not exists pitwall;
revoke all on schema pitwall from public;

-- A device can identify an anonymous event only when its supplied links agree.
create or replace function pitwall.identity(actors text[])
returns text language sql immutable set search_path='' as $$
  select case when count(distinct actor)=1 then min(actor) end from unnest(actors) actor;
$$;
revoke all on function pitwall.identity(text[]) from public;
