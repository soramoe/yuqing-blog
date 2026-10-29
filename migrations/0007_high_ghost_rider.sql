CREATE TABLE `point_redemption_code` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`code_hint` text NOT NULL,
	`amount` integer NOT NULL,
	`batch_id` text NOT NULL,
	`created_by_user_id` text,
	`redeemed_by_user_id` text,
	`expires_at` integer,
	`redeemed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`redeemed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "point_redemption_code_amount_positive" CHECK("point_redemption_code"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `point_redemption_code_hash_unique` ON `point_redemption_code` (`code_hash`);--> statement-breakpoint
CREATE INDEX `point_redemption_code_batch_idx` ON `point_redemption_code` (`batch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `point_redemption_code_redeemed_idx` ON `point_redemption_code` (`redeemed_by_user_id`,`redeemed_at`);--> statement-breakpoint
CREATE TABLE `shop_item` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`cover_url` text,
	`price_points` integer NOT NULL,
	`stock` integer NOT NULL,
	`per_user_limit` integer DEFAULT 1 NOT NULL,
	`delivery_note` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "shop_item_price_positive" CHECK("shop_item"."price_points" > 0),
	CONSTRAINT "shop_item_stock_nonnegative" CHECK("shop_item"."stock" >= 0),
	CONSTRAINT "shop_item_limit_positive" CHECK("shop_item"."per_user_limit" > 0)
);
--> statement-breakpoint
CREATE INDEX `shop_item_active_sort_idx` ON `shop_item` (`active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `shop_order` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`item_name` text NOT NULL,
	`item_description` text NOT NULL,
	`delivery_note` text DEFAULT '' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price` integer NOT NULL,
	`total_points` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`request_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `shop_item`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "shop_order_status_valid" CHECK("shop_order"."status" in ('pending', 'fulfilled', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shop_order_request_unique` ON `shop_order` (`user_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `shop_order_user_created_idx` ON `shop_order` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `shop_order_status_created_idx` ON `shop_order` (`status`,`created_at`);