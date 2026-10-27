-- Opening buildings for every player (owner's decision, 2026-10-27): there is no recognition model yet
-- (ADR-001), so the «scan by location» of migration 009 — standing within the building's scan radius,
-- GPS accuracy ≤ 35 m, a photo — is opened to all players, not only to listed testers.
--
-- submit_building_scan() and is_location_scan_tester() stay as they are: every player is simply put on the
-- list, existing ones now and new ones when their profile is created. Such scans are still stored with
-- model_version = 'location-test-v1' and can be told apart later.
--
-- What it proves: the player was next to the building. Not what was photographed, and a faked GPS
-- position is not detected (no device attestation yet).
--
-- To switch it off again (testers added by hand keep their own note):
--   drop trigger if exists profiles_location_scan on public.profiles;
--   delete from public.location_scan_testers where note = 'all players (030)';

insert into public.location_scan_testers (user_id, note)
select p.id, 'all players (030)'
from public.profiles p
on conflict (user_id) do nothing;

create or replace function public._location_scan_for_new_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.location_scan_testers (user_id, note)
  values (new.id, 'all players (030)')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke execute on function public._location_scan_for_new_player() from public, anon, authenticated;

drop trigger if exists profiles_location_scan on public.profiles;
create trigger profiles_location_scan
  after insert on public.profiles
  for each row execute function public._location_scan_for_new_player();
