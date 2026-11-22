CREATE TABLE `story_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`points_per_turn` integer DEFAULT 4 NOT NULL,
	`max_output_tokens` integer DEFAULT 1000 NOT NULL,
	`context_turns` integer DEFAULT 4 NOT NULL,
	`daily_turn_limit` integer DEFAULT 30 NOT NULL,
	`site_key_enabled` integer DEFAULT true NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `story_setting_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `story_setting_audit_created_idx` ON `story_setting_audit` (`created_at`);