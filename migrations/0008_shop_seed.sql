-- Custom SQL migration file, put your code below! --
CREATE TRIGGER `point_account_balance_nonnegative`
BEFORE UPDATE OF `balance` ON `point_account`
FOR EACH ROW
WHEN NEW.`balance` < 0
BEGIN
  SELECT RAISE(ABORT, 'insufficient_points');
END;
--> statement-breakpoint

CREATE TRIGGER `shop_order_active_item`
BEFORE INSERT ON `shop_order`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM `shop_item`
  WHERE `id` = NEW.`item_id` AND `active` = true AND `stock` > 0
)
BEGIN
  SELECT RAISE(ABORT, 'shop_item_unavailable');
END;
--> statement-breakpoint

CREATE TRIGGER `shop_order_transition_from_pending`
BEFORE UPDATE OF `status` ON `shop_order`
FOR EACH ROW
WHEN OLD.`status` <> 'pending' AND NEW.`status` <> OLD.`status`
BEGIN
  SELECT RAISE(ABORT, 'shop_order_not_pending');
END;
--> statement-breakpoint

INSERT OR IGNORE INTO `shop_item`
  (`id`, `name`, `description`, `cover_url`, `price_points`, `stock`,
   `per_user_limit`, `delivery_note`, `active`, `sort_order`,
   `created_at`, `updated_at`)
VALUES
  ('fish-badge', '渔情限定徽章',
   '点亮个人账号中的渔情身份标记，兑换后由站长登记。',
   NULL, 30, 100, 1,
   '兑换成功后请联系站长完成徽章登记；第一版为人工发放。',
   true, 10,
   cast(unixepoch('subsecond') * 1000 as integer),
   cast(unixepoch('subsecond') * 1000 as integer)),
  ('wallpaper-pack', '高清壁纸包',
   '一套渔情主题高清壁纸，适合桌面与手机使用。',
   NULL, 50, 50, 1,
   '兑换成功后由站长提供壁纸下载地址。',
   true, 20,
   cast(unixepoch('subsecond') * 1000 as integer),
   cast(unixepoch('subsecond') * 1000 as integer)),
  ('comment-title', '自定义评论称号',
   '为账号设置一个专属评论称号，展示在评论身份旁。',
   NULL, 80, 30, 1,
   '兑换成功后由站长确认称号文字并完成设置。',
   true, 30,
   cast(unixepoch('subsecond') * 1000 as integer),
   cast(unixepoch('subsecond') * 1000 as integer));
