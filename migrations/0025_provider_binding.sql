ALTER TABLE `image_provider` ADD `api_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `image_provider` ADD `base_url` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `image_provider` SET `features` = 'story_chapter,image_studio,admin_test' WHERE `adapter` <> 'colab-sdxl';
--> statement-breakpoint
UPDATE `image_provider` SET `enabled` = 1 WHERE `id` IN ('cloudflare-workers-ai', 'qwen-image', 'siliconflow-image');
