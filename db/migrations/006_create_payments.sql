create table if not exists payment_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider varchar(20) not null check (provider in ('stripe', 'razorpay')),
  api_key_id_encrypted text,
  api_secret_encrypted text not null,
  webhook_secret_encrypted text not null,
  currency char(3) not null default 'USD',
  status varchar(20) not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table if not exists payment_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  booking_id uuid references bookings(id) on delete set null,
  payment_connection_id uuid not null references payment_connections(id) on delete restrict,
  provider varchar(20) not null check (provider in ('stripe', 'razorpay')),
  provider_link_id varchar(255) not null,
  provider_payment_id varchar(255),
  url text not null,
  amount integer not null check (amount > 0),
  currency char(3) not null,
  description text not null,
  status varchar(20) not null default 'issued' check (status in ('issued', 'paid', 'failed', 'expired', 'cancelled')),
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_link_id)
);

create index if not exists payment_links_workspace_created_idx on payment_links (workspace_id, created_at desc);
create index if not exists payment_links_booking_idx on payment_links (booking_id) where booking_id is not null;

create table if not exists payment_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  payment_link_id uuid references payment_links(id) on delete set null,
  provider varchar(20) not null check (provider in ('stripe', 'razorpay')),
  provider_event_id varchar(255) not null,
  event_type varchar(120) not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create index if not exists payment_events_workspace_received_idx on payment_events (workspace_id, received_at desc);

alter table booking_services add column if not exists price_amount integer check (price_amount is null or price_amount > 0);
alter table booking_services add column if not exists currency char(3);
alter table booking_services add column if not exists deposit_amount integer check (deposit_amount is null or deposit_amount > 0);
