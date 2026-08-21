create table if not exists scheduled_customer_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  channel varchar(20) not null check (channel in ('email', 'whatsapp')),
  purpose varchar(30) not null check (purpose in ('update', 'payment_link')),
  body text not null,
  payment_link_id uuid references payment_links(id) on delete set null,
  scheduled_for timestamptz not null,
  status varchar(20) not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  provider_message_id varchar(255),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_customer_messages_due_idx on scheduled_customer_messages (status, scheduled_for) where status = 'scheduled';
create index if not exists scheduled_customer_messages_customer_idx on scheduled_customer_messages (workspace_id, customer_id, scheduled_for desc);
