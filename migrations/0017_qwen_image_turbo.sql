UPDATE `image_provider`
SET `model` = 'qwen-image-2.1-turbo',
    `actual_cost_cents` = 10,
    `reserve_cost_cents` = 12,
    `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `id` = 'qwen-image';
