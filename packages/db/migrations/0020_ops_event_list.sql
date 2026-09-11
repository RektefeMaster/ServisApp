-- Faz 8: olay listesi ve açık atama satırları.

create index if not exists event_tenant_occurred_idx
  on event (tenant_id, occurred_at_server desc);

create index if not exists trip_vehicle_assignment_open_idx
  on trip_vehicle_assignment (tenant_id, trip_id)
  where valid_to is null;

create index if not exists trip_crew_assignment_open_idx
  on trip_crew_assignment (tenant_id, trip_id, role)
  where valid_to is null;
