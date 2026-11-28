-- 互动小说生图独立开关：默认开启，后台「生图控制」可单独关闭
ALTER TABLE `image_setting` ADD `story_enabled` integer DEFAULT 1 NOT NULL;

-- 互动小说插画按 features 白名单路由；当前已开放的供应商只声明了 image_studio，
-- 导致 story_chapter 没有任何可用模型。把已开放 AI 生图的供应商一并纳入。
UPDATE `image_provider`
SET `features` = `features` || ',story_chapter'
WHERE `enabled` = 1
  AND `features` LIKE '%image_studio%'
  AND `features` NOT LIKE '%story_chapter%';
