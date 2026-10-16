-- Registration step "game profile": nickname + preset avatar, completed once per account.
-- avatar_key names one of the brand pictograms (src/components/ui/figures.ts).

alter table public.profiles
  add column avatar_key text check (avatar_key in ('runner', 'scooter', 'skater', 'cyclist')),
  add column setup_completed_at timestamptz;

-- avatar stays cosmetic and editable later; completion is set only by the function below
grant update (avatar_key) on public.profiles to authenticated;

create or replace function public.complete_profile_setup(p_username text, p_avatar_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_username text := btrim(coalesce(p_username, ''));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if v_username !~ '^[A-Za-z0-9_А-Яа-яЁё]{3,24}$'
     or p_avatar_key is null
     or p_avatar_key not in ('runner', 'scooter', 'skater', 'cyclist') then
    raise exception 'invalid_profile' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(v_username) and id <> v_uid) then
    raise exception 'username_taken' using errcode = 'P0001';
  end if;

  update public.profiles
     set username = v_username,
         avatar_key = p_avatar_key,
         setup_completed_at = coalesce(setup_completed_at, now())
   where id = v_uid;
  if not found then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;
exception
  when unique_violation then
    raise exception 'username_taken' using errcode = 'P0001';
end;
$$;

revoke execute on function public.complete_profile_setup(text, text) from public, anon;
grant execute on function public.complete_profile_setup(text, text) to authenticated;
