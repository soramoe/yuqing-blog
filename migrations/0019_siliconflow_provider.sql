INSERT OR IGNORE INTO `image_provider`
  (`id`, `name`, `adapter`, `model`, `enabled`, `priority`,
   `daily_job_limit`, `monthly_budget_cents`, `reserve_cost_cents`,
   `actual_cost_cents`, `allow_paid_overage`, `failure_threshold`,
   `cooldown_seconds`, `consecutive_failures`, `cooldown_until`, `updated_at`)
VALUES
  ('siliconflow-image', '硅基流动图片', 'openai-images', 'Qwen/Qwen-Image',
   false, 30, 100, 5000, 25, 20, false, 3, 600, 0, NULL,
   cast(unixepoch('subsecond') * 1000 as integer));
