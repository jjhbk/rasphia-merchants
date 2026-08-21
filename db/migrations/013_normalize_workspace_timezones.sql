update workspaces
set timezone = 'Asia/Kolkata', updated_at = now()
where timezone in ('India', 'IST', 'Indian Standard Time', 'Asia/Calcutta');
