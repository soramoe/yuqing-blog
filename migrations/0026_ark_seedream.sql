INSERT INTO `image_provider`
  (`id`, `name`, `adapter`, `model`, `features`, `api_key`, `base_url`,
   `enabled`, `priority`, `daily_job_limit`, `monthly_budget_cents`,
   `reserve_cost_cents`, `actual_cost_cents`, `allow_paid_overage`,
   `failure_threshold`, `cooldown_seconds`, `updated_at`)
VALUES
  ('ark-seedream', '火山方舟 Seedream', 'ark-images', 'doubao-seedream-3-0-t2i-250415',
   'image_studio,admin_test', '', '', 1, 15, 150, 5000, 0, 0, 1, 3, 600,
   CAST(strftime('%s','now') AS integer) * 1000);
