import { isCommentAdmin } from "./comment-admin";

interface SystemNotifyEnv {
  DB: D1Database;
  COMMENT_ADMIN_USER_IDS?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

interface SystemNotification {
  type: string;
  title: string;
  body: string;
  link?: string;
}

const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 同类提醒 30 分钟内只发一次

function adminUserIds(env: SystemNotifyEnv) {
  return (env.COMMENT_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

// 给所有站长发一条站内信；相同 type 在冷却窗口内只发一次，成功后顺便发邮件。
// 返回 true 表示本次确实创建了新提醒。
export async function notifyAdmins(
  env: SystemNotifyEnv,
  input: SystemNotification,
) {
  const admins = adminUserIds(env);
  if (admins.length === 0) return false;
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, admins[0])) return false;

  const now = Date.now();
  const recent = await env.DB.prepare(
    `SELECT id FROM notification
     WHERE type = ? AND created_at > ?
     LIMIT 1`,
  )
    .bind(input.type, now - DEDUP_WINDOW_MS)
    .first<{ id: string }>();
  if (recent) return false;

  try {
    await env.DB.batch(
      admins.map((userId) =>
        env.DB.prepare(
          `INSERT INTO notification
            (id, user_id, type, title, body, link, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          userId,
          input.type,
          input.title,
          input.body,
          input.link ?? null,
          now,
        ),
      ),
    );
  } catch {
    return false;
  }

  await emailAdmins(env, admins, input);
  return true;
}

async function emailAdmins(
  env: SystemNotifyEnv,
  admins: string[],
  input: SystemNotification,
) {
  if (!env.RESEND_API_KEY?.trim() || !env.EMAIL_FROM?.trim()) return;
  const placeholders = admins.map(() => "?").join(", ");
  let recipients: string[] = [];
  try {
    const rows = await env.DB.prepare(
      `SELECT email FROM user WHERE id IN (${placeholders})`,
    )
      .bind(...admins)
      .all<{ email: string }>();
    recipients = rows.results
      .map((row) => row.email)
      .filter((email) => Boolean(email?.trim()));
  } catch {
    return;
  }
  if (recipients.length === 0) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: recipients,
        subject: input.title,
        text: [
          input.body,
          input.link ? `\n详情：https://xhz6.com${input.link}` : "",
          "",
          "—— 渔情站内提醒",
        ].join("\n"),
      }),
    });
    // 邮件失败不影响站内信，静默处理
  } catch {
    // 同上
  }
}

// Colab GPU 掉线提醒（站内信 + 邮件，30 分钟去重）
export async function notifyColabDown(env: SystemNotifyEnv) {
  return notifyAdmins(env, {
    type: "colab_down",
    title: "GPU 生图服务掉线",
    body:
      "Colab 上的 SDXL 服务暂时无法连接，AI 生图页面会显示「服务正忙」，" +
      "用户积分会在生成失败时自动退回。请尽快到 Colab 重跑启动单元恢复服务。",
    link: "/ai-image/",
  });
}
