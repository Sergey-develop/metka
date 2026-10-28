-- «Голос леса» belongs to «Голоса леса» (2026-10-28). The artifact of the forest route «Следы лесного
-- хранителя» (forest-voice) sat in «Трофеи маршрутов», while the collection «Голоса леса» (the signs of the
-- nature places, migration 028) is named after it: the quest promised «Голос леса» and «Голоса леса» stayed
-- 0/5. It now ends that collection; who has it keeps it (player_artifacts is by artifact).

update public.artifacts
   set collection_id = 'zav-forest-voices',
       ord = 6
 where id = 'forest-voice';
