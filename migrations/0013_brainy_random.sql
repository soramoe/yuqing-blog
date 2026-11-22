CREATE TABLE `story_trial_budget` (
	`day` text PRIMARY KEY NOT NULL,
	`reserved_cents` integer DEFAULT 0 NOT NULL,
	`spent_cents` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `story_trial_claim` (
	`user_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`provider` text NOT NULL,
	`free_turns_total` integer NOT NULL,
	`free_turns_used` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `story_trial_ip_day` (
	`day` text NOT NULL,
	`ip_hash` text NOT NULL,
	`claims` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_trial_ip_day_unique` ON `story_trial_ip_day` (`day`,`ip_hash`);--> statement-breakpoint
ALTER TABLE `story_setting` ADD `trial_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `story_setting` ADD `trial_github_turns` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `story_setting` ADD `trial_email_turns` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `story_setting` ADD `trial_max_output_tokens` integer DEFAULT 600 NOT NULL;--> statement-breakpoint
ALTER TABLE `story_setting` ADD `trial_daily_budget_yuan` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `story_setting` ADD `trial_ip_daily_limit` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `story_publication` ADD `cover_url` text;--> statement-breakpoint
ALTER TABLE `story_tip` ADD `message` text;