-- =========================
-- Roles
-- =========================
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

create policy "users read own roles"
on public.user_roles for select to authenticated
using (user_id = auth.uid());

create policy "admins read all roles"
on public.user_roles for select to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- =========================
-- Profiles (Telegram identity)
-- =========================
create table public.profiles (
  id uuid primary key,
  telegram_id bigint unique,
  telegram_username text,
  display_name text,
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);

grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create policy "read own profile"
on public.profiles for select to authenticated
using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy "update own profile"
on public.profiles for update to authenticated
using (id = auth.uid());

-- =========================
-- Exercise catalogue
-- =========================
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  muscle_group text,
  equipment text,
  difficulty text,
  tags text[] not null default '{}',
  storage_path text not null,
  thumb_path text,
  duration_seconds numeric,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

create index exercises_muscle_idx on public.exercises (muscle_group);
create index exercises_equipment_idx on public.exercises (equipment);
create index exercises_title_trgm_idx on public.exercises using gin (to_tsvector('simple', title));

grant select on public.exercises to authenticated;
grant all on public.exercises to service_role;
alter table public.exercises enable row level security;

create policy "authenticated read published exercises"
on public.exercises for select to authenticated
using (is_published = true);

create policy "admins manage exercises"
on public.exercises for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

-- =========================
-- Entitlements (what the user bought)
-- =========================
create type public.access_plan as enum ('view', 'download');

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan public.access_plan not null,
  status text not null default 'active',
  source text not null default 'paypal',
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index entitlements_user_idx on public.entitlements (user_id, status);

grant select on public.entitlements to authenticated;
grant all on public.entitlements to service_role;
alter table public.entitlements enable row level security;

create policy "read own entitlements"
on public.entitlements for select to authenticated
using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- highest active plan for a user
create or replace function public.current_plan(_user_id uuid)
returns public.access_plan
language sql
stable
security definer
set search_path = public
as $$
  select plan from public.entitlements
  where user_id = _user_id
    and status = 'active'
    and (expires_at is null or expires_at > now())
  order by (plan = 'download') desc, granted_at desc
  limit 1
$$;

-- =========================
-- Payments (idempotent PayPal records)
-- =========================
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paypal',
  provider_order_id text not null,
  provider_capture_id text,
  telegram_id bigint,
  user_id uuid,
  plan public.access_plan not null,
  amount numeric(10,2) not null,
  currency text not null default 'USD',
  status text not null default 'pending',
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_order_id)
);

grant all on public.payments to service_role;
alter table public.payments enable row level security;

create policy "admins read payments"
on public.payments for select to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- =========================
-- One-time web login links issued by the bot
-- =========================
create table public.access_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  telegram_id bigint not null,
  user_id uuid,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index access_links_expiry_idx on public.access_links (expires_at);

grant all on public.access_links to service_role;
alter table public.access_links enable row level security;

-- =========================
-- Audit / anti-sharing
-- =========================
create table public.access_events (
  id bigserial primary key,
  user_id uuid,
  exercise_id uuid,
  action text not null,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index access_events_user_time_idx on public.access_events (user_id, created_at desc);

grant all on public.access_events to service_role;
alter table public.access_events enable row level security;

create policy "admins read access events"
on public.access_events for select to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- =========================
-- Job queue (Telegram fan-out, rate limited)
-- =========================
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts int not null default 0,
  run_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_pending_idx on public.jobs (status, run_at);

grant all on public.jobs to service_role;
alter table public.jobs enable row level security;

create policy "admins read jobs"
on public.jobs for select to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- =========================
-- Raw Telegram updates (fast webhook ack + idempotency)
-- =========================
create table public.telegram_updates (
  update_id bigint primary key,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

grant all on public.telegram_updates to service_role;
alter table public.telegram_updates enable row level security;

-- =========================
-- Claim a batch of jobs atomically (no double-processing)
-- =========================
create or replace function public.claim_jobs(_limit int default 25)
returns setof public.jobs
language sql
volatile
security definer
set search_path = public
as $$
  update public.jobs j
  set status = 'processing', attempts = j.attempts + 1, updated_at = now()
  where j.id in (
    select id from public.jobs
    where status = 'pending' and run_at <= now()
    order by run_at
    limit _limit
    for update skip locked
  )
  returning j.*;
$$;

revoke all on function public.claim_jobs(int) from public;
grant execute on function public.claim_jobs(int) to service_role;
