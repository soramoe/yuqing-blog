CREATE TABLE `gallery_upload` (
	`id` text PRIMARY KEY NOT NULL,
	`base_name` text NOT NULL,
	`title` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`upload_date` text NOT NULL,
	`uploader_user_id` text,
	`anonymous_hash` text,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	FOREIGN KEY (`uploader_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gallery_upload_base_name_unique` ON `gallery_upload` (`base_name`);--> statement-breakpoint
CREATE INDEX `gallery_upload_status_created_idx` ON `gallery_upload` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `gallery_upload_user_created_idx` ON `gallery_upload` (`uploader_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `gallery_upload_date_idx` ON `gallery_upload` (`upload_date`);--> statement-breakpoint
CREATE TABLE `gallery_upload_quota` (
	`subject_key` text NOT NULL,
	`upload_date` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`subject_key`, `upload_date`)
);
