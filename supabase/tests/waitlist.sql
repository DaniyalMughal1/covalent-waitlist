-- Run after the migration against a disposable database: psql -v ON_ERROR_STOP=1 -f this-file.
begin;
set local role service_role;
do $$
declare
  result text;
  original_row public.waitlist%rowtype;
begin
  result := public.join_waitlist('  Example+tag@EXAMPLE.COM ', 'linkedin', 'friend-01', repeat('a', 64));
  if result <> 'accepted' then raise exception 'First signup failed'; end if;
  select * into strict original_row from public.waitlist where email = 'example+tag@example.com';
  if original_row.id is null or original_row.created_at is null then raise exception 'Missing defaults'; end if;
  result := public.join_waitlist('EXAMPLE+TAG@example.com', 'x', 'other-referral', repeat('b', 64));
  if result <> 'duplicate' then raise exception 'Case-insensitive duplicate failed'; end if;
  if (select count(*) from public.waitlist where email = original_row.email) <> 1
     or not exists (select 1 from public.waitlist where id = original_row.id
                    and source = 'linkedin' and referral_code = 'friend-01'
                    and created_at = original_row.created_at) then
    raise exception 'Duplicate changed original attribution';
  end if;
  if public.join_waitlist('invalid', 'direct', null, repeat('c', 64)) <> 'invalid' then
    raise exception 'Invalid email accepted';
  end if;
  if public.join_waitlist('rate1@example.com', 'direct', null, repeat('d', 64), 2, 600) <> 'accepted'
     or public.join_waitlist('rate2@example.com', 'direct', null, repeat('d', 64), 2, 600) <> 'accepted'
     or public.join_waitlist('rate3@example.com', 'direct', null, repeat('d', 64), 2, 600) <> 'rate_limited'
     or exists(select 1 from public.waitlist where email = 'rate3@example.com') then
    raise exception 'Database rate limit failed';
  end if;
  update waitlist_private.rate_limits set expires_at = now() - interval '1 second' where client_hash = repeat('d', 64);
  if public.join_waitlist('rate3@example.com', 'direct', null, repeat('d', 64), 2, 600) <> 'accepted' then
    raise exception 'Expired rate window did not reset';
  end if;
  begin
    insert into public.waitlist (email) values ('UPPERCASE@example.com');
    raise exception 'Normalization constraint missing';
  exception when check_violation then null;
  end;
end;
$$;
reset role;

do $$
declare browser_role text;
begin
  foreach browser_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(browser_role, 'public.waitlist', 'SELECT')
       or has_table_privilege(browser_role, 'public.waitlist', 'INSERT')
       or has_function_privilege(browser_role, 'public.join_waitlist(text,text,text,text,integer,integer)', 'EXECUTE')
       or has_schema_privilege(browser_role, 'waitlist_private', 'USAGE') then
      raise exception 'Browser role can access signup data';
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.waitlist'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'waitlist_private.rate_limits'::regclass) then
    raise exception 'RLS is not enabled';
  end if;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform email from public.waitlist;
    raise exception 'Anonymous read unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.join_waitlist('anonymous@example.com', 'direct', null, repeat('e', 64));
    raise exception 'Anonymous RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
