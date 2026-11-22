-- Jalankan setelah membuat dua secret di Supabase Vault.
-- Aktifkan pg_cron dan pg_net jika belum aktif melalui Database > Extensions.
-- Simpan project URL dan CRON_SECRET di Vault, jangan tulis rahasia langsung di SQL.
-- Contoh pembuatan secret (jalankan sekali, ganti nilainya):
-- select vault.create_secret('https://PROJECT_REF.supabase.co', 'smartstudy_project_url');
-- select vault.create_secret('ISI_CRON_SECRET_YANG_SAMA_DENGAN_EDGE_FUNCTION', 'smartstudy_cron_secret');

select cron.unschedule('smartstudy-push-every-minute')
where exists (select 1 from cron.job where jobname = 'smartstudy-push-every-minute');

select cron.schedule(
  'smartstudy-push-every-minute',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'smartstudy_project_url') || '/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'smartstudy_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    ) as request_id;
  $$
);
