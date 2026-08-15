create table if not exists business_diagnoses (
  id uuid primary key default gen_random_uuid(),
  input_value text not null,
  input_kind varchar(30) not null,
  status varchar(20) not null default 'researching',
  research jsonb,
  questions jsonb,
  answers jsonb,
  report jsonb,
  email varchar(254),
  blob_url text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists business_diagnoses_created_at_idx on business_diagnoses (created_at desc);
