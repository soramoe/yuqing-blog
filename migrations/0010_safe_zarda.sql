ALTER TABLE `gallery_upload` ADD `visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `gallery_upload` ADD `has_private_preview` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `gallery_upload` ADD `visibility_updated_at` integer;--> statement-breakpoint
CREATE INDEX `gallery_upload_visibility_created_idx` ON `gallery_upload` (`visibility`,`created_at`);