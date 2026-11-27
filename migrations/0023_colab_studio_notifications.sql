ALTER TABLE `image_setting` ADD `studio_points` integer DEFAULT 120 NOT NULL;
--> statement-breakpoint
ALTER TABLE `image_provider` ADD `features` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `image_provider` SET `features` = 'story_chapter,admin_test' WHERE `adapter` <> 'colab-sdxl';
--> statement-breakpoint
INSERT INTO `image_provider`
  (`id`, `name`, `adapter`, `model`, `features`, `enabled`, `priority`,
   `daily_job_limit`, `monthly_budget_cents`, `reserve_cost_cents`,
   `actual_cost_cents`, `allow_paid_overage`, `failure_threshold`,
   `cooldown_seconds`, `consecutive_failures`, `updated_at`)
VALUES
  ('colab-sdxl', 'Colab SDXL', 'colab-sdxl', 'sd_xl_base_1.0',
   'image_studio,admin_test', 1, 5, 150, 0, 0, 0, 1, 3, 600, 0,
   CAST(strftime('%s','now') AS integer) * 1000);
--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_user_created_idx` ON `notification` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `notification_type_created_idx` ON `notification` (`type`,`created_at`);
