-- Faz 3: bir rotada aynı anda tek PUBLISHED ve tek DRAFT; taslak duraklar
-- yeniden yazılabilir; aynı durak bir sürümde bir kez yer alır.

create unique index route_version_one_published
  on route_version (tenant_id, route_id)
  where status = 'PUBLISHED';

create unique index route_version_one_draft
  on route_version (tenant_id, route_id)
  where status = 'DRAFT';

alter table route_stop
  add constraint route_stop_seq_positive check (seq >= 1);

alter table route_stop
  add constraint route_stop_stop unique (tenant_id, route_version_id, stop_id);

grant delete on table route_stop, route_stop_student to servisapp_api, servisapp_worker;
