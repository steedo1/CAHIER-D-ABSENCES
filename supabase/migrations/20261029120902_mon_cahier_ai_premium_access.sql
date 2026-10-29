-- Optional paid module: absence of a row always means disabled.
-- Only trusted server code (which verifies super_admin) may manage entitlements.
create table public.institution_ai_module_settings (
  institution_id uuid primary key references public.institutions(id) on delete cascade,
  ai_premium_enabled boolean not null default false,
  expires_on date,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.institution_ai_module_settings enable row level security;
revoke all on table public.institution_ai_module_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.institution_ai_module_settings to service_role;
create policy ai_module_service_only on public.institution_ai_module_settings
  for all to service_role using (true) with check (true);
comment on table public.institution_ai_module_settings is
  'Mon Cahier IA entitlement managed exclusively by super-admin server actions; default disabled.';

-- All application calls use the server client after the module check.
-- A direct Data API RPC must not bypass the paid-module entitlement.
revoke execute on function public.predict_success_for_class(uuid,uuid,text,date,numeric) from public, anon, authenticated;
grant execute on function public.predict_success_for_class(uuid,uuid,text,date,numeric) to service_role;
