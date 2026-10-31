UPDATE `image_provider`
SET `adapter` = 'dashscope-images',
    `model` = 'qwen-image-2.0-pro',
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `id` = 'qwen-image';
