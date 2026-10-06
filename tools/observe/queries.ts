/**
 * The questions `pnpm observe` asks, as SQL over the command ledger
 * (`commands`) and field telemetry (`telemetry.events`, ADR-0011). Each takes
 * `$1`, the look-back window as a Postgres interval ('7 days'). Run with the
 * owner role, read-only.
 */

export const VOLUME = `
select
  (select count(*) from commands where executed_at > now() - $1::interval)::int as commands,
  (select count(distinct workspace_id) from commands where executed_at > now() - $1::interval)::int as workspaces,
  (select count(*) from telemetry.events where received_at > now() - $1::interval)::int as events,
  (select count(*) from telemetry.events where kind = 'session' and received_at > now() - $1::interval)::int as sessions,
  (select count(distinct app_version) from telemetry.events where received_at > now() - $1::interval)::int as releases`;

/** Every write, by command: how often it runs, fails, and how long the server takes. */
export const LEDGER = `
select command_type as command,
  count(*)::int as total,
  count(*) filter (where status = 'EXECUTED')::int as executed,
  count(*) filter (where status = 'REJECTED')::int as rejected,
  count(*) filter (where status = 'FAILED')::int as failed,
  round(100.0 * count(*) filter (where status <> 'EXECUTED') / count(*), 1)::float as "failPct",
  percentile_cont(0.5) within group (order by duration_ms)::int as "p50Ms",
  percentile_cont(0.95) within group (order by duration_ms)::int as "p95Ms"
from commands
where executed_at > now() - $1::interval
group by command_type
order by total desc`;

/** Why writes are refused: the friction users hit, by the stable error code. */
export const REJECTIONS = `
select command_type as command, failure_code as code, count(*)::int as count,
  count(distinct initiated_by_principal_id)::int as people
from commands
where status <> 'EXECUTED' and executed_at > now() - $1::interval
group by command_type, failure_code
order by count desc
limit 15`;

/**
 * How late writes reach the server after the user acted: offline capture shows
 * up here. Only origins a device replays; imports and scripts (CSV_IMPORT, API)
 * backdate on purpose, and the demo seed would read as days of lag.
 */
export const LAG = `
select origin,
  count(*)::int as count,
  round(percentile_cont(0.5) within group (order by extract(epoch from executed_at - client_occurred_at))::numeric, 1)::float as "p50S",
  round(percentile_cont(0.95) within group (order by extract(epoch from executed_at - client_occurred_at))::numeric, 1)::float as "p95S",
  round(max(extract(epoch from executed_at - client_occurred_at))::numeric, 1)::float as "maxS"
from commands
where client_occurred_at is not null and origin in ('HUMAN_UI', 'OFFLINE_SYNC') and executed_at > now() - $1::interval
group by origin
order by count desc`;

/** How long money entries wait for a decision, and how many still wait. */
export const APPROVALS = `
with submitted as (
  select result->>'recordId' as entry_id, executed_at as at
  from commands
  where approval_outcome = 'APPROVAL_REQUIRED' and status = 'EXECUTED' and result->>'recordId' is not null
    and executed_at > now() - $1::interval
), decided as (
  select payload->>'entryId' as entry_id, command_type, min(executed_at) as at
  from commands
  where command_type in ('approve-entry', 'reject-entry') and status = 'EXECUTED'
  group by 1, 2
)
select
  count(*)::int as submitted,
  count(d.entry_id)::int as decided,
  (count(*) - count(d.entry_id))::int as waiting,
  round((percentile_cont(0.5) within group (order by extract(epoch from d.at - s.at)) / 3600)::numeric, 2)::float as "p50Hours",
  round((percentile_cont(0.95) within group (order by extract(epoch from d.at - s.at)) / 3600)::numeric, 2)::float as "p95Hours",
  round((max(extract(epoch from now() - s.at)) filter (where d.entry_id is null) / 3600)::numeric, 1)::float as "oldestWaitingHours"
from submitted s left join decided d using (entry_id)`;

/** Client errors grouped by fingerprint: one row per distinct problem. */
export const ERRORS = `
select fingerprint,
  count(*)::int as count,
  count(distinct session_id)::int as sessions,
  min(received_at) as "firstSeen",
  max(received_at) as "lastSeen",
  string_agg(distinct route, ', ') as routes,
  string_agg(distinct app_version, ', ') as releases,
  (array_agg(name order by received_at desc))[1] as source,
  (array_agg(message order by received_at desc))[1] as message
from telemetry.events
where kind = 'error' and received_at > now() - $1::interval
group by fingerprint
order by count desc
limit 15`;

/** What users run ROUTIQ on: memory, cores, network, and the share on phones. */
export const DEVICES = `
select
  coalesce(device->>'deviceMemoryGb', '?') as "memoryGb",
  coalesce(device->>'cpuCores', '?') as cores,
  coalesce(device->'connection'->>'effectiveType', '?') as network,
  case when (device->>'mobile')::boolean then 'phone' when (device->>'mobile')::boolean = false then 'desktop' else '?' end as kind,
  count(*)::int as sessions,
  percentile_cont(0.5) within group (order by (device->'connection'->>'rttMs')::float)::int as "rttP50Ms",
  percentile_cont(0.5) within group (order by (device->'connection'->>'downlinkMbps')::float)::float as "downlinkP50Mbps"
from telemetry.events
where kind = 'session' and received_at > now() - $1::interval
group by 1, 2, 3, 4
order by sessions desc
limit 12`;

/** Journeys: from a user's action to its result on screen, split into server and client time. */
export const JOURNEYS = `
select name,
  count(*)::int as n,
  percentile_cont(0.5) within group (order by value)::int as "p50Ms",
  percentile_cont(0.75) within group (order by value)::int as "p75Ms",
  percentile_cont(0.95) within group (order by value)::int as "p95Ms",
  percentile_cont(0.5) within group (order by server_ms)::int as "serverP50Ms",
  round(100.0 * count(*) filter (where outcome <> 'ok') / count(*), 1)::float as "notOkPct"
from telemetry.events
where kind = 'journey' and received_at > now() - $1::interval
group by name
order by n desc
limit 25`;

/** Core Web Vitals at p75, with the share of loads inside Google's "good" threshold. */
export const VITALS = `
with thresholds(name, good) as (values ('TTFB', 800), ('FCP', 1800), ('LCP', 2500), ('INP', 200), ('CLS', 0.1))
select e.name,
  count(*)::int as n,
  round(percentile_cont(0.75) within group (order by e.value)::numeric, 3)::float as p75,
  t.good::float as "goodAt",
  round(100.0 * count(*) filter (where e.value <= t.good) / count(*), 1)::float as "goodPct"
from telemetry.events e join thresholds t using (name)
where e.kind = 'vital' and e.received_at > now() - $1::interval
group by e.name, t.good
order by e.name`;

/** One metric's samples in the newest release that has any, for the field ratchet. */
export const FIELD_P75 = `
with latest as (
  select app_version from telemetry.events
  where kind = $2 and name = $3 and received_at > now() - $1::interval
  group by app_version
  order by max(received_at) desc
  limit 1
)
select app_version as release, count(*)::int as n,
  percentile_cont(0.75) within group (order by value)::float as p75
from telemetry.events
where kind = $2 and name = $3 and received_at > now() - $1::interval
  and app_version = (select app_version from latest)
group by app_version`;
