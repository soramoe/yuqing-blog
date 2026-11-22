CREATE TABLE `image_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`prompt` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `image_job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `image_provider`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_asset_job_id_unique` ON `image_asset` (`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `image_asset_r2_key_unique` ON `image_asset` (`r2_key`);--> statement-breakpoint
CREATE INDEX `image_asset_user_created_idx` ON `image_asset` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `image_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `image_job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `image_provider`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "image_attempt_status_valid" CHECK("image_attempt"."status" in ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `image_attempt_job_created_idx` ON `image_attempt` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `image_attempt_provider_created_idx` ON `image_attempt` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `image_config_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`config_type` text NOT NULL,
	`config_id` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `image_config_audit_created_idx` ON `image_config_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `image_config_audit_target_idx` ON `image_config_audit` (`config_type`,`config_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `image_job` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`user_id` text NOT NULL,
	`feature` text NOT NULL,
	`source_id` text,
	`prompt` text NOT NULL,
	`negative_prompt` text DEFAULT '' NOT NULL,
	`quality` text DEFAULT 'standard' NOT NULL,
	`aspect_ratio` text DEFAULT '1:1' NOT NULL,
	`points_cost` integer NOT NULL,
	`balance_after` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider_id` text,
	`model` text,
	`permission` text DEFAULT 'private' NOT NULL,
	`error_code` text,
	`error_message` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `image_provider`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "image_job_status_valid" CHECK("image_job"."status" in ('pending', 'processing', 'succeeded', 'failed')),
	CONSTRAINT "image_job_quality_valid" CHECK("image_job"."quality" in ('standard', 'hd'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_job_user_request_unique` ON `image_job` (`user_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `image_job_user_created_idx` ON `image_job` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `image_job_status_created_idx` ON `image_job` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `image_job_source_idx` ON `image_job` (`feature`,`source_id`);--> statement-breakpoint
CREATE TABLE `image_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`adapter` text NOT NULL,
	`model` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`daily_job_limit` integer DEFAULT 100 NOT NULL,
	`monthly_budget_cents` integer DEFAULT 5000 NOT NULL,
	`reserve_cost_cents` integer DEFAULT 12 NOT NULL,
	`actual_cost_cents` integer DEFAULT 10 NOT NULL,
	`allow_paid_overage` integer DEFAULT false NOT NULL,
	`failure_threshold` integer DEFAULT 3 NOT NULL,
	`cooldown_seconds` integer DEFAULT 600 NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`cooldown_until` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT "image_provider_priority_nonnegative" CHECK("image_provider"."priority" >= 0),
	CONSTRAINT "image_provider_daily_limit_nonnegative" CHECK("image_provider"."daily_job_limit" >= 0)
);
--> statement-breakpoint
CREATE INDEX `image_provider_enabled_priority_idx` ON `image_provider` (`enabled`,`priority`);--> statement-breakpoint
CREATE TABLE `image_provider_usage` (
	`provider_id` text NOT NULL,
	`period` text NOT NULL,
	`jobs` integer DEFAULT 0 NOT NULL,
	`successes` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`reserved_cents` integer DEFAULT 0 NOT NULL,
	`spent_cents` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`provider_id`, `period`),
	FOREIGN KEY (`provider_id`) REFERENCES `image_provider`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `image_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`point_value_cents` integer DEFAULT 1 NOT NULL,
	`standard_points` integer DEFAULT 24 NOT NULL,
	`hd_points` integer DEFAULT 36 NOT NULL,
	`daily_job_limit` integer DEFAULT 100 NOT NULL,
	`monthly_budget_cents` integer DEFAULT 5000 NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT OR IGNORE INTO `image_setting`
  (`id`, `enabled`, `point_value_cents`, `standard_points`, `hd_points`,
   `daily_job_limit`, `monthly_budget_cents`, `updated_by`, `updated_at`)
VALUES
  ('global', false, 1, 24, 36, 100, 5000, NULL,
   cast(unixepoch('subsecond') * 1000 as integer));
--> statement-breakpoint
INSERT OR IGNORE INTO `image_provider`
  (`id`, `name`, `adapter`, `model`, `enabled`, `priority`,
   `daily_job_limit`, `monthly_budget_cents`, `reserve_cost_cents`,
   `actual_cost_cents`, `allow_paid_overage`, `failure_threshold`,
   `cooldown_seconds`, `consecutive_failures`, `cooldown_until`, `updated_at`)
VALUES
  ('cloudflare-workers-ai', 'Cloudflare Workers AI', 'workers-ai',
   '@cf/black-forest-labs/flux-1-schnell', true, 10, 100, 0, 0, 0,
   false, 3, 600, 0, NULL,
   cast(unixepoch('subsecond') * 1000 as integer)),
  ('qwen-image', '千问图片', 'openai-images', 'qwen-image-plus',
   true, 20, 100, 5000, 12, 10, false, 3, 600, 0, NULL,
   cast(unixepoch('subsecond') * 1000 as integer));
