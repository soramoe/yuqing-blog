CREATE TABLE `daily_checkin` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`checkin_date` text NOT NULL,
	`points` integer NOT NULL,
	`transaction_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_checkin_transaction_id_unique` ON `daily_checkin` (`transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_checkin_user_date_unique` ON `daily_checkin` (`user_id`,`checkin_date`);--> statement-breakpoint
CREATE INDEX `daily_checkin_user_created_idx` ON `daily_checkin` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `point_account` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `point_transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`reference_id` text NOT NULL,
	`balance_after` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `point_transaction_reference_id_unique` ON `point_transaction` (`reference_id`);--> statement-breakpoint
CREATE INDEX `point_transaction_user_created_idx` ON `point_transaction` (`user_id`,`created_at`);