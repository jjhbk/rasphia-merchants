alter table payment_links add column if not exists payment_offering_id uuid references payment_offerings(id) on delete set null;
create index if not exists payment_links_offering_idx on payment_links (payment_offering_id) where payment_offering_id is not null;
