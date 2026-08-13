create table if not exists merchant_interests (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  business_name varchar(160) not null,
  email varchar(254) not null,
  phone varchar(40),
  business_type varchar(100),
  message text,
  source varchar(50) not null default 'landing-page',
  created_at timestamptz not null default now()
);

create index if not exists merchant_interests_created_at_idx on merchant_interests (created_at desc);
create index if not exists merchant_interests_email_idx on merchant_interests (email);
