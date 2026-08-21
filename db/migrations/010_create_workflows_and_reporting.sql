create table if not exists workspace_workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  service_slug varchar(80) not null references rasphia_services(slug),
  status varchar(20) not null default 'draft' check (status in ('draft', 'test', 'active', 'paused')),
  config jsonb not null default '{}'::jsonb,
  activated_at timestamptz,
  activated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, service_slug)
);

create index if not exists workspace_workflows_workspace_status_idx on workspace_workflows (workspace_id, status, updated_at desc);

create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workflow_id uuid not null references workspace_workflows(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  trigger_type varchar(100) not null,
  status varchar(20) not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  input jsonb not null default '{}'::jsonb,
  outcome jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workflow_runs_workspace_created_idx on workflow_runs (workspace_id, created_at desc);

create table if not exists workflow_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  action_type varchar(100) not null,
  channel varchar(20),
  status varchar(20) not null default 'queued' check (status in ('queued', 'sent', 'completed', 'failed', 'skipped')),
  payload jsonb not null default '{}'::jsonb,
  executed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workflow_actions_run_created_idx on workflow_actions (workflow_run_id, created_at asc);
