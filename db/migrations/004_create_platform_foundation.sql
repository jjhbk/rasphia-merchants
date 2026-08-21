create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email varchar(254) not null,
  name varchar(160),
  avatar_url text,
  email_verified_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_email_lower_uidx on users (lower(email));

create table if not exists oauth_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider varchar(40) not null,
  provider_account_id varchar(255) not null,
  provider_email varchar(254),
  granted_scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_account_id)
);

create index if not exists oauth_accounts_user_id_idx on oauth_accounts (user_id);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash char(64) not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  user_agent text,
  ip_hash char(64)
);

create index if not exists user_sessions_active_idx on user_sessions (user_id, expires_at) where revoked_at is null;

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name varchar(160) not null,
  slug varchar(180) not null unique,
  timezone varchar(80) not null default 'UTC',
  country_code char(2),
  onboarding_status varchar(30) not null default 'profile',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role varchar(20) not null check (role in ('owner', 'admin', 'staff', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx on workspace_members (user_id);

create table if not exists workspace_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  business_email varchar(254),
  business_type varchar(100),
  address text,
  brand_tone varchar(80) not null default 'warm and professional',
  preferred_channels text[] not null default array['email']::text[],
  booking_slug varchar(180) unique,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rasphia_services (
  slug varchar(80) primary key,
  name varchar(120) not null,
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into rasphia_services (slug, name, description) values
  ('instant-lead-response', 'Instant lead response', 'Reply, qualify, route, and book new enquiries.'),
  ('follow-up-reactivation', 'Customer follow-up & reactivation', 'Bring first-time and lapsed customers back at the right moment.'),
  ('review-reputation', 'Review & reputation management', 'Request reviews and route unhappy customer feedback privately.'),
  ('booking-no-show', 'Booking & no-show protection', 'Confirm, remind, collect deposits, and recover missed appointments.'),
  ('membership-renewal', 'Membership & renewal retention', 'Nudge members when attendance falls or renewal is due.'),
  ('quote-repeat-service', 'Quote follow-up & repeat service', 'Turn open quotes into jobs and schedule the next service.'),
  ('payment-package', 'Payment & package automation', 'Send and track payment links, deposits, packages, and reminders.'),
  ('local-discovery', 'Local discovery & AI visibility', 'Make the business easier to find and choose online.')
on conflict (slug) do update set name = excluded.name, description = excluded.description;

create table if not exists workspace_service_preferences (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  service_slug varchar(80) not null references rasphia_services(slug),
  status varchar(20) not null default 'recommended' check (status in ('recommended', 'draft', 'active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, service_slug)
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email varchar(254),
  phone varchar(40),
  first_name varchar(120),
  last_name varchar(120),
  source varchar(80),
  status varchar(30) not null default 'active',
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);

create unique index if not exists customers_workspace_email_uidx on customers (workspace_id, lower(email)) where email is not null;
create unique index if not exists customers_workspace_phone_uidx on customers (workspace_id, phone) where phone is not null;
create index if not exists customers_workspace_created_idx on customers (workspace_id, created_at desc);

create table if not exists customer_consents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  channel varchar(20) not null check (channel in ('email', 'whatsapp')),
  status varchar(20) not null check (status in ('opted_in', 'opted_out')),
  source varchar(100) not null,
  consent_text_version varchar(80),
  recorded_at timestamptz not null default now(),
  unique (customer_id, channel, recorded_at)
);

create index if not exists customer_consents_workspace_customer_idx on customer_consents (workspace_id, customer_id, channel, recorded_at desc);

create table if not exists customer_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  event_type varchar(80) not null,
  source varchar(80) not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists customer_events_timeline_idx on customer_events (workspace_id, customer_id, occurred_at desc);
