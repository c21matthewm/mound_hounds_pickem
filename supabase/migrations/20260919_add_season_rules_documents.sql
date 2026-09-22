-- Optional Admin workspace capability. Documents are public, immutable objects;
-- only the Admin server action uploads them. Existing PDFs are retained for recovery.
begin;

-- Never turn an existing private bucket public or broaden its file limits.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('season-rules', 'season-rules', true, 5242880, array['application/pdf'])
on conflict (id) do nothing;
do $$
declare configured storage.buckets%rowtype;
begin
  select * into configured from storage.buckets where id = 'season-rules' for update;
  if configured.name <> 'season-rules' or configured.public is distinct from true
    or configured.file_size_limit is distinct from 5242880::bigint
    or configured.allowed_mime_types is distinct from array['application/pdf']::text[] then
    raise exception 'The existing season-rules bucket has unexpected settings. Review it before enabling rules uploads.';
  end if;
end;
$$;

-- A permissive policy added for another bucket must not enable direct writes to
-- these immutable documents. The service role bypasses RLS; public URL delivery
-- is handled by Storage's public-bucket endpoint and does not require this policy.
drop policy if exists season_rules_server_managed on storage.objects;
create policy season_rules_server_managed on storage.objects
as restrictive for all to anon, authenticated
using (bucket_id <> 'season-rules')
with check (bucket_id <> 'season-rules');

create or replace function public.set_league_season_rules_document(
  p_season_id bigint,
  p_rules_document_url text,
  p_expected_rules_document_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set lock_timeout = '3s'
set statement_timeout = '10s'
as $$
declare
  selected_season public.league_seasons%rowtype;
  rules_url text := nullif(p_rules_document_url, '');
  url_parts text[];
begin
  if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
    raise exception using errcode = '42501', message = 'Only an administrator can update season rules.';
  end if;
  -- Serialize with demotion. Participation eligibility is intentionally irrelevant.
  perform id from public.profiles where id = auth.uid() and role = 'admin' for share nowait;
  if not found then
    raise exception using errcode = '42501', message = 'Administrator access changed. Refresh and try again.';
  end if;
  if p_season_id is null or p_season_id <= 0 or length(p_expected_rules_document_url) > 2048 then
    raise exception using errcode = '22023', message = 'Refresh Seasons & League before changing its rules.';
  end if;
  if rules_url is not null then
    if length(rules_url) > 2048 or rules_url ~ '[[:space:][:cntrl:]]'
      or position(chr(92) in rules_url) > 0 or rules_url ~* '%(0[0-9a-f]|1[0-9a-f]|7f|5c)' then
      raise exception using errcode = '22023', message = 'Use a site path or secure HTTPS URL without spaces or control characters.';
    end if;
    if left(rules_url, 1) = '/' then
      if left(rules_url, 2) = '//' then
        raise exception using errcode = '22023', message = 'Site paths must start with a single slash.';
      end if;
    else
      url_parts := regexp_match(rules_url, '^https://([a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:([0-9]{1,5}))?([/?#].*)?$', 'i');
      if url_parts is null or position('..' in url_parts[1]) > 0 or coalesce(url_parts[4]::int, 443) > 65535 then
        raise exception using errcode = '22023', message = 'Use a valid HTTPS URL without embedded credentials.';
      end if;
    end if;
  end if;
  select * into selected_season from public.league_seasons where id = p_season_id for update nowait;
  if not found or selected_season.status not in ('active', 'upcoming') then
    raise exception using errcode = '22023', message = 'Rules can only be changed for an active or upcoming season.';
  end if;
  if selected_season.rules_document_url is distinct from nullif(p_expected_rules_document_url, '') then
    raise exception using errcode = '40001', message = 'The rules document has changed. Refresh Seasons & League before trying again.';
  end if;
  if selected_season.rules_document_url is not distinct from rules_url then
    return jsonb_build_object('season_id', selected_season.id, 'rules_document_url', rules_url, 'changed', false);
  end if;
  update public.league_seasons set rules_document_url = rules_url where id = selected_season.id;
  perform public.write_admin_audit_event(
    'update_rules_document', 'league_season', selected_season.id::text,
    format('Updated the %s rules document.', selected_season.season_year),
    jsonb_build_object('rules_document_url', selected_season.rules_document_url),
    jsonb_build_object('rules_document_url', rules_url)
  );
  return jsonb_build_object('season_id', selected_season.id, 'rules_document_url', rules_url, 'changed', true);
end;
$$;

revoke all on function public.set_league_season_rules_document(bigint, text, text) from public, anon, service_role;
grant execute on function public.set_league_season_rules_document(bigint, text, text) to authenticated;

commit;
