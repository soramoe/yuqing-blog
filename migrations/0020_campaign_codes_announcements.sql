CREATE TABLE `point_campaign_code` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`code_key` text NOT NULL,
	`amount` integer NOT NULL,
	`max_redemptions` integer,
	`redeemed_count` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`starts_at` integer,
	`expires_at` integer,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "point_campaign_code_amount_positive" CHECK("point_campaign_code"."amount" > 0),
	CONSTRAINT "point_campaign_code_limit_positive" CHECK("point_campaign_code"."max_redemptions" IS NULL OR "point_campaign_code"."max_redemptions" > 0),
	CONSTRAINT "point_campaign_code_count_nonnegative" CHECK("point_campaign_code"."redeemed_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `point_campaign_code_key_unique` ON `point_campaign_code` (`code_key`);--> statement-breakpoint
CREATE INDEX `point_campaign_code_active_created_idx` ON `point_campaign_code` (`active`,`created_at`);
--> statement-breakpoint
CREATE TABLE `point_campaign_redemption` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`user_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`redeemed_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `point_campaign_code`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `point_campaign_redemption_transaction_unique` ON `point_campaign_redemption` (`transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `point_campaign_redemption_user_unique` ON `point_campaign_redemption` (`campaign_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `point_campaign_redemption_campaign_time_idx` ON `point_campaign_redemption` (`campaign_id`,`redeemed_at`);
--> statement-breakpoint
CREATE TABLE `site_announcement` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`type` text DEFAULT 'info' NOT NULL,
	`placement` text DEFAULT 'site' NOT NULL,
	`link_url` text,
	`link_text` text,
	`active` integer DEFAULT true NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "site_announcement_type_valid" CHECK("site_announcement"."type" in ('info', 'success', 'warning', 'maintenance')),
	CONSTRAINT "site_announcement_placement_valid" CHECK("site_announcement"."placement" in ('site', 'points', 'shop'))
);
--> statement-breakpoint
CREATE INDEX `site_announcement_active_created_idx` ON `site_announcement` (`active`,`created_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `site_announcement`
  (`id`, `title`, `body`, `type`, `placement`, `link_url`, `link_text`,
   `active`, `starts_at`, `ends_at`, `created_by_user_id`, `created_at`,
   `updated_at`)
VALUES
  ('points-recharge-notice', '积分充值说明',
   '在线充值暂未开放。当前可以通过每日签到、参与活动或领取活动兑换码获得积分。',
   'info', 'points', '/shop/', '查看兑换码', true, NULL, NULL, NULL,
   cast(unixepoch('subsecond') * 1000 as integer),
   cast(unixepoch('subsecond') * 1000 as integer));
