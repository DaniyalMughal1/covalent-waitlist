-- Run once in the Supabase SQL Editor, or apply with `supabase db push`.
-- The public table is visible in the dashboard, but inaccessible to browser roles.
begin;

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now(),
  source text not null default 'direct',
  referral_code text,
  constraint waitlist_email_normalized check (
    email = lower(btrim(email)) and char_length(email) between 3 and 254
    and email !~ '[[:space:][:cntrl:]]' and email ~ '.+@[^@]+[.][^@]+'
  ),
  constraint waitlist_source_valid check (source ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint waitlist_referral_valid check (referral_code is null or referral_code ~ '^[a-zA-Z0-9_-]{1,64}$')
);
create index waitlist_created_at_idx on public.waitlist (created_at desc);
alter table public.waitlist enable row level security;
revoke all on public.waitlist from public, anon, authenticated;
grant select, insert, update, delete on public.waitlist to service_role;

-- Not exposed through the Data API. Only HMAC digests, never raw IP addresses.
create schema if not exists waitlist_private;
revoke all on schema waitlist_private from public, anon, authenticated;
grant usage on schema waitlist_private to service_role;
create table waitlist_private.rate_limits (
  client_hash text primary key check (client_hash ~ '^[a-f0-9]{64}$'),
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null
);
create index waitlist_rate_limits_expiry_idx on waitlist_private.rate_limits (expires_at);
alter table waitlist_private.rate_limits enable row level security;
revoke all on waitlist_private.rate_limits from public, anon, authenticated;
grant select, insert, update, delete on waitlist_private.rate_limits to service_role;

-- One transaction: atomic shared rate counter, then idempotent signup.
-- SECURITY INVOKER means this has only the caller's privileges, not the owner's.
create function public.join_waitlist(
  p_email text,
  p_source text,
  p_referral_code text,
  p_client_hash text,
  p_limit integer default 20,
  p_window_seconds integer default 600
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(p_email));
  current_time_at timestamptz := clock_timestamp();
  attempt_count integer;
  inserted_id uuid;
begin
  if p_limit is null or p_limit not between 1 and 1000
     or p_window_seconds is null or p_window_seconds not between 1 and 86400
     or p_client_hash is null or p_client_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid rate limit configuration';
  end if;
  if normalized_email is null or char_length(normalized_email) not between 3 and 254
     or normalized_email ~ '[[:space:][:cntrl:]]' or normalized_email !~ '.+@[^@]+[.][^@]+'
     or p_source is null or p_source !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
     or (p_referral_code is not null and p_referral_code !~ '^[a-zA-Z0-9_-]{1,64}$') then
    return 'invalid';
  end if;

  -- Opportunistic expiry cleanup; idle projects may retain expired hashes until the next request.
  delete from waitlist_private.rate_limits where expires_at <= current_time_at;
  insert into waitlist_private.rate_limits as bucket (client_hash, attempts, expires_at)
    values (p_client_hash, 1, current_time_at + make_interval(secs => p_window_seconds))
    on conflict (client_hash) do update set
      attempts = case when bucket.expires_at <= current_time_at then 1
                      else least(bucket.attempts + 1, p_limit + 1) end,
      expires_at = case when bucket.expires_at <= current_time_at
                        then current_time_at + make_interval(secs => p_window_seconds)
                        else bucket.expires_at end
    returning attempts into attempt_count;
  if attempt_count > p_limit then return 'rate_limited'; end if;

  insert into public.waitlist (email, source, referral_code)
    values (normalized_email, p_source, p_referral_code)
    on conflict (email) do nothing returning id into inserted_id;
  if inserted_id is null then return 'duplicate'; end if;
  return 'accepted';
end;
$$;
revoke all on function public.join_waitlist(text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.join_waitlist(text, text, text, text, integer, integer) to service_role;
notify pgrst, 'reload schema';
commit;
