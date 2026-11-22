CREATE TABLE `story_cloud_save` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slot` integer NOT NULL,
	`title` text NOT NULL,
	`session_id` text NOT NULL,
	`turn_index` integer NOT NULL,
	`data_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_cloud_save_user_slot_unique` ON `story_cloud_save` (`user_id`,`slot`);--> statement-breakpoint
CREATE INDEX `story_cloud_save_user_updated_idx` ON `story_cloud_save` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `story_publication` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`source_session_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`template_id` text NOT NULL,
	`mode_id` text NOT NULL,
	`difficulty_id` text NOT NULL,
	`style` text NOT NULL,
	`content_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`read_count` integer DEFAULT 0 NOT NULL,
	`tip_total` integer DEFAULT 0 NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_at` integer,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_publication_slug_unique` ON `story_publication` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_publication_author_session_unique` ON `story_publication` (`author_user_id`,`source_session_id`);--> statement-breakpoint
CREATE INDEX `story_publication_status_published_idx` ON `story_publication` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `story_publication_author_updated_idx` ON `story_publication` (`author_user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `story_tip` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`transaction_ref` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`publication_id`) REFERENCES `story_publication`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_tip_transaction_ref_unique` ON `story_tip` (`transaction_ref`);--> statement-breakpoint
CREATE INDEX `story_tip_publication_created_idx` ON `story_tip` (`publication_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `story_tip_from_created_idx` ON `story_tip` (`from_user_id`,`created_at`);