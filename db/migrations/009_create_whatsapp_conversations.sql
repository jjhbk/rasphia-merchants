create table if not exists whatsapp_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  enabled boolean not null default false,
  intake_keyword varchar(64) not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customer_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  channel varchar(20) not null check (channel in ('email', 'whatsapp')),
  external_key varchar(255) not null,
  status varchar(20) not null default 'open' check (status in ('open', 'needs_human', 'closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, channel, external_key)
);

create index if not exists customer_conversations_workspace_last_message_idx on customer_conversations (workspace_id, last_message_at desc);
create index if not exists customer_conversations_channel_key_idx on customer_conversations (channel, external_key, last_message_at desc);

create table if not exists conversation_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid not null references customer_conversations(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  channel varchar(20) not null check (channel in ('email', 'whatsapp')),
  direction varchar(10) not null check (direction in ('inbound', 'outbound')),
  provider_message_id varchar(255),
  message_type varchar(30) not null default 'text',
  body text,
  status varchar(30) not null default 'received',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (channel, provider_message_id)
);

create index if not exists conversation_messages_conversation_created_idx on conversation_messages (conversation_id, created_at asc);
