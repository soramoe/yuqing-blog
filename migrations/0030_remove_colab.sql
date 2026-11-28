-- Colab SDXL 退出生图：停用其供应商行（保留行以维持 image_attempt 历史关联）
UPDATE `image_provider`
SET `enabled` = 0,
    `updated_at` = CAST(strftime('%s','now') AS integer) * 1000
WHERE `id` = 'colab-sdxl';
