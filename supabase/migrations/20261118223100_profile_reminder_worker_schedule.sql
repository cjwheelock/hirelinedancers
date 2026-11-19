-- Every minute, same vault secrets as the inquiry notification worker.
select cron.schedule('process-hld-profile-reminders','* * * * *',$cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'hld_project_url') || '/functions/v1/profile-reminder-worker',
    headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name = 'hld_notification_worker_key')),
    body := '{"limit":5}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);
