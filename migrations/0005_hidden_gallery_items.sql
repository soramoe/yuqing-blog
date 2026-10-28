CREATE TABLE `gallery_hidden_item` (
	`item_key` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`hidden_by` text,
	`hidden_at` integer NOT NULL,
	FOREIGN KEY (`hidden_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
