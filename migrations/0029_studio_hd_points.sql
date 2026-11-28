-- AI 生图 2K 独立定价：1K 沿用 studio_points，2K 使用 studio_hd_points
ALTER TABLE `image_setting` ADD `studio_hd_points` integer DEFAULT 1000 NOT NULL;
