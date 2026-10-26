create schema if not exists pitwall;
revoke all on schema pitwall from public;

-- A batch query over supplied records. This function reads no application tables.
create or replace function pitwall.report(records jsonb, options jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  start_at timestamptz:=(options->>'from')::timestamptz;
  end_at timestamptz:=(options->>'to')::timestamptz;
  zone text:=coalesce(options->>'timezone','UTC');
  metric text:=options->>'event'; measure text:=coalesce(options->>'measure','events'); person text:=options->>'person';
  steps text[]:=array(select jsonb_array_elements_text(coalesce(options->'steps','[]')));
  hidden text[]:=array(select jsonb_array_elements_text(coalesce(options->'hidden_events','[]')));
  sum_fields jsonb:=coalesce(options->'sums','{}');
  correlate boolean:=coalesce((options->>'correlate')::boolean,false);
  allow_unlinked boolean:=coalesce((options->>'allow_unlinked')::boolean,false);
begin
  if jsonb_typeof(records) is distinct from 'array' or start_at is null or end_at is null or start_at>=end_at
    or not isfinite(start_at) or not isfinite(end_at) or coalesce(btrim(metric),'')=''
    or measure not in ('events','people') or cardinality(steps)=1 or cardinality(steps)>6
    or jsonb_typeof(sum_fields) is distinct from 'object' then raise exception 'Invalid report settings.'; end if;
  if exists(select 1 from jsonb_array_elements(records) e where jsonb_typeof(e->'properties') is distinct from 'object'
      or exists(select 1 from unnest(array['id','event','distinct_id','occurred_at']) field
        where jsonb_typeof(e->field) is distinct from 'string' or btrim(e->>field)='')
      or not isfinite((e->>'occurred_at')::timestamptz))
    or (select count(distinct e->>'id') from jsonb_array_elements(records) e)<>jsonb_array_length(records)
    then raise exception 'Expected event records with unique IDs.'; end if;
  return (
    with recursive facts as materialized (
      select e as record,e->>'id' as id,e->>'event' as event,e->>'distinct_id' as distinct_id,
        (e->>'occurred_at')::timestamptz as at,e->'properties' as properties,
        case when correlate then e->>'correlation' end as correlation
      from jsonb_array_elements(records) e
      where (e->>'occurred_at')::timestamptz>start_at and (e->>'occurred_at')::timestamptz<=end_at
        and (person is null or e->>'distinct_id'=person)
    ), selected as (select * from facts where event=metric), people as (
      select f.distinct_id,min(at) as first_seen,max(at) as last_seen,count(*) filter(where event=metric) as selected_events,
        (select e.record from facts e where e.distinct_id=f.distinct_id order by e.at,e.id limit 1) as first,
        (select e.record from facts e where e.distinct_id=f.distinct_id
          and (options->>'profile_property' is null or e.properties->>(options->>'profile_property') is not null)
          order by e.at desc,e.id desc limit 1) as profile,
        (select jsonb_object_agg(step,duration) from (
          select properties->>(options#>>'{timing,step}') as step,sum((properties->>(options#>>'{timing,duration}'))::bigint) as duration
          from facts t where t.distinct_id=f.distinct_id and t.event=options#>>'{timing,event}'
          group by properties->>(options#>>'{timing,step}')) t) as active_ms
      from facts f group by f.distinct_id having person is not null or bool_or(event=metric)
    ), paths(distinct_id,stage,entered,at,last_id,correlation) as (
      (select distinct on(distinct_id,correlation) distinct_id,0,at,at,id,correlation from facts where event=steps[1]
        order by distinct_id,correlation,at,id)
      union all
      (select distinct on(p.distinct_id,p.stage+1,coalesce(p.correlation,e.correlation),case when p.stage+1=cardinality(steps)-1 then e.id end)
        p.distinct_id,p.stage+1,p.entered,e.at,e.id,coalesce(p.correlation,e.correlation)
        from paths p join facts e on e.distinct_id=p.distinct_id and e.event=steps[p.stage+2] and (e.at,e.id)>(p.at,p.last_id)
          and (not correlate or p.correlation=e.correlation or allow_unlinked and (p.correlation is null or e.correlation is null))
        where p.stage+1<cardinality(steps)
        order by p.distinct_id,p.stage+1,coalesce(p.correlation,e.correlation),case when p.stage+1=cardinality(steps)-1 then e.id end,e.at,p.entered)
    ), progress as (
      select distinct on(distinct_id) * from paths order by distinct_id,stage desc,at,entered
    ), stages as (
      select n as rank,steps[n+1] as name,count(distinct p.distinct_id) as count
      from generate_series(0,cardinality(steps)-1) n left join paths p on p.stage=n group by n
    ), final_events as (select * from facts where event=steps[cardinality(steps)]), conversion as (
      select jsonb_build_object('unit','people','steps',to_jsonb(steps),'cohort',(select count(*) from progress),
        'stages',(select jsonb_agg(to_jsonb(s) order by rank) from stages s),
        'elapsed_ms',(select avg(extract(epoch from(at-entered))*1000) from progress where stage=cardinality(steps)-1),
        'final_events',(select count(*) from final_events),'matched_events',(select count(distinct last_id) from paths where stage=cardinality(steps)-1),
        'members',(select coalesce(jsonb_agg(to_jsonb(m) order by started_at desc),'[]') from (
          select p.distinct_id,p.stage,p.entered as started_at,case when p.stage=cardinality(steps)-1 then p.at end as converted_at,
            case when p.stage=cardinality(steps)-1 then extract(epoch from(p.at-p.entered))*1000 end as elapsed_ms,
            (select e.record from facts e where e.distinct_id=p.distinct_id order by e.at,e.id limit 1) as first
          from progress p order by p.entered desc limit 100) m),
        'outside',(select coalesce(jsonb_agg(e.record order by e.at desc,e.id desc),'[]') from (
          select * from final_events e where not exists(select 1 from paths p where p.stage=cardinality(steps)-1 and p.last_id=e.id)
          order by e.at desc,e.id desc limit 100) e)) as data
    )
    select jsonb_build_object(
      'insight',jsonb_build_object('total',(select count(*) from selected),'people',(select count(distinct distinct_id) from selected),
        'sums',(select coalesce(jsonb_object_agg(key,total),'{}') from (
          select k.key,coalesce(sum((e.properties->>k.value)::numeric),0) as total
          from jsonb_each_text(sum_fields) k left join selected e on true group by k.key) s),
        'series',(select jsonb_agg(jsonb_build_object('date',d::date,'count',case when measure='events'
          then (select count(*) from selected e where (e.at at time zone zone)::date=d::date)
          else (select count(distinct distinct_id) from selected e where (e.at at time zone zone)::date=d::date) end,
          'sums',(select coalesce(jsonb_object_agg(key,total),'{}') from (
            select k.key,coalesce(sum((e.properties->>k.value)::numeric),0) as total from jsonb_each_text(sum_fields) k
            left join selected e on (e.at at time zone zone)::date=d::date group by k.key) s)) order by d)
          from generate_series(start_at at time zone zone,end_at at time zone zone,interval '1 day') d)),
      'event_counts',(select coalesce(jsonb_object_agg(event,n),'{}') from (
        select event,count(*) as n from facts where not event=any(hidden) group by event) e),
      'funnel',case when cardinality(steps)>0 then (select data from conversion) end,
      'people',(select coalesce(jsonb_agg(to_jsonb(p) order by last_seen desc),'[]') from (
        select * from people order by last_seen desc limit 100) p),
      'events',(select coalesce(jsonb_agg(e.record order by e.at desc,e.id desc),'[]') from (
        select * from facts where not event=any(hidden) and (person is not null or event=metric)
        order by at desc,id desc limit 200) e)
    )
  );
end;
$$;
revoke all on function pitwall.report(jsonb,jsonb) from public;
