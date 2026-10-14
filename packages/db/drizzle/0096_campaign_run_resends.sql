alter table campaign_runs
  add column resend_of_run_id text references campaign_runs(id) on delete restrict,
  add column resend_delay_days integer;

alter table campaign_runs
  add constraint campaign_runs_resend_delay_days_check
  check (resend_delay_days is null or resend_delay_days between 1 and 14);

create unique index campaign_runs_resend_of_run_unique
  on campaign_runs (resend_of_run_id)
  where resend_of_run_id is not null;
