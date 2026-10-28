CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`post_slug` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`parent_id` text,
	`status` text DEFAULT 'visible' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `comment`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `comment_post_created_idx` ON `comment` (`post_slug`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `comment_user_created_idx` ON `comment` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comment_parent_idx` ON `comment` (`parent_id`);