alter table whatsapp_settings add column if not exists template_config jsonb not null default '{}'::jsonb;
