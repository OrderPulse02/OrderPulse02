-- =====================================================================
--  ORDER PULSE — AUTOMATIC JOBS
--  Run AFTER 01_setup.sql, in Supabase → SQL Editor.
--  (If it says pg_cron is missing: Database → Extensions → enable "pg_cron",
--   then run this file again.)
-- =====================================================================
create extension if not exists pg_cron with schema pg_catalog;

-- Every minute: expire orders the admin did not answer in time.
select cron.schedule('orderpulse-expire-orders', '* * * * *',
  $$select public.expire_stale_orders()$$);

-- Every night at 00:05 India time (18:35 UTC): build yesterday's report.
select cron.schedule('orderpulse-daily-report', '35 18 * * *',
  $$select public.generate_daily_report()$$);

-- To see the jobs:     select * from cron.job;
-- To see job history:  select * from cron.job_run_details order by start_time desc limit 20;
