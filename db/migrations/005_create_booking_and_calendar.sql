create table if not exists google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references workspaces(id) on delete cascade,
  google_email varchar(254),
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  granted_scopes text[] not null default '{}',
  selected_calendar_id text,
  selected_calendar_name varchar(255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists booking_services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name varchar(160) not null,
  description text,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists booking_services_workspace_active_idx on booking_services (workspace_id, active, sort_order, created_at);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete restrict,
  service_id uuid not null references booking_services(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone varchar(80) not null,
  status varchar(30) not null default 'requested' check (status in ('requested', 'confirmed', 'cancelled', 'completed', 'no_show')),
  calendar_event_id text,
  customer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists bookings_workspace_start_idx on bookings (workspace_id, starts_at desc);
create index if not exists bookings_customer_start_idx on bookings (customer_id, starts_at desc);
create unique index if not exists bookings_workspace_calendar_event_uidx on bookings (workspace_id, calendar_event_id) where calendar_event_id is not null;

create table if not exists booking_reminders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  channel varchar(20) not null check (channel in ('email', 'whatsapp')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status varchar(20) not null default 'scheduled' check (status in ('scheduled', 'sent', 'failed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists booking_reminders_due_idx on booking_reminders (status, scheduled_for) where status = 'scheduled';

create table if not exists outbound_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  booking_id uuid references bookings(id) on delete set null,
  channel varchar(20) not null check (channel in ('email', 'whatsapp')),
  recipient varchar(254) not null,
  subject varchar(255),
  template_key varchar(80),
  provider_message_id varchar(255),
  status varchar(20) not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists outbound_messages_workspace_created_idx on outbound_messages (workspace_id, created_at desc);
