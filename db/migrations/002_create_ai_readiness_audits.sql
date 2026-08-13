create table if not exists ai_readiness_audits (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  domain varchar(255) not null,
  status varchar(20) not null default 'pending',
  scores jsonb,
  email varchar(254),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists ai_readiness_audits_domain_created_idx on ai_readiness_audits (domain, created_at desc);
create table if not exists ai_readiness_rate_limits (
  ip varchar(64) not null,
  day date not null,
  checks integer not null default 0,
  primary key (ip, day)
);
