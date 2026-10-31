ALTER TABLE `site_announcement` ADD `priority` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `site_announcement` ADD `target_path` text;
--> statement-breakpoint
CREATE INDEX `site_announcement_active_priority_idx` ON `site_announcement` (`active`,`priority`,`created_at`);
