create table if not exists payment_offerings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  payment_connection_id uuid references payment_connections(id) on delete set null,
  name varchar(160) not null,
  description text,
  payment_type varchar(30) not null check (payment_type in ('one_time', 'deposit', 'package', 'recurring')),
  amount integer not null check (amount > 0),
  currency char(3) not null,
  billing_interval varchar(20) check (billing_interval in ('day', 'week', 'month', 'year')),
  interval_count integer check (interval_count is null or interval_count between 1 and 36),
  total_cycles integer check (total_cycles is null or total_cycles > 0),
  trial_days integer check (trial_days is null or trial_days >= 0),
  provider_plan_id varchar(255),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((payment_type = 'recurring' and billing_interval is not null and interval_count is not null) or payment_type <> 'recurring')
);

create index if not exists payment_offerings_workspace_active_idx on payment_offerings (workspace_id, active, created_at desc);

create table if not exists customer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete restrict,
  payment_offering_id uuid not null references payment_offerings(id) on delete restrict,
  payment_connection_id uuid not null references payment_connections(id) on delete restrict,
  provider varchar(20) not null check (provider in ('stripe', 'razorpay')),
  provider_subscription_id varchar(255) not null,
  status varchar(30) not null default 'pending' check (status in ('pending', 'active', 'paused', 'cancelled', 'past_due', 'completed')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);

create index if not exists customer_subscriptions_workspace_status_idx on customer_subscriptions (workspace_id, status, created_at desc);
