-- Davet önizlemesi tenant GUC olmadan token_hash ile okunur.
-- FORCE RLS + app_tenant_id() politikası, bağlam yokken 500 üretir.

grant select, update on table guardian_invite to servisapp_definer;

create policy guardian_invite_definer_lookup on guardian_invite
  as permissive for all
  to servisapp_definer
  using (true)
  with check (true);
