-- Phones of the Zavidovo restaurants (2026-10-28) for «Забронировать» on the place page, looked up by hand
-- in public sources (not scraped):
--   * «Царевна»   +7 495 191-25-25 — Afisha and Tripadvisor (Zavidovo Spa Village, Чистый Плёс, 1);
--   * «СырЗавод»  +7 958 118-77-88 — the resort's page yamskaya.zavidovo.com/restaurants and go-tver.ru;
--   * «БарХан»    +7 916 335-07-76 — yamskaya.zavidovo.com/restaurants;
--   * «Трактиръ»  +7 920 680-45-80 — yamskaya.zavidovo.com/restaurants; the number of migration 027 came with
--     the site yatraktir.ru, which no longer exists, so the site is the resort's restaurants page now;
--   * «Жуковка»   +7 499 226-22-59 — only Restoclub (address Чистый Плёс, 10 matches): to be checked.
-- «Гастробар by Simple»: no phone found anywhere, left without one (no button).

update public.area_places set phone = '+7 495 191-25-25' where id = 'zav-tsarevna';
update public.area_places set phone = '+7 958 118-77-88' where id = 'zav-syrzavod';
update public.area_places set phone = '+7 916 335-07-76' where id = 'zav-barhan';
update public.area_places
   set phone = '+7 920 680-45-80',
       website = 'https://yamskaya.zavidovo.com/restaurants/'
 where id = 'zav-traktir';
update public.area_places set phone = '+7 499 226-22-59' where id = 'zav-zhukovka';
