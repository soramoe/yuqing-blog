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

interface EmailResult {
  sent: boolean;
  recipients: string[];
  reason?: string;
}

const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 同类提醒 30 分钟内只发一次

function adminUserIds(env: SystemNotifyEnv) {
  return (env.COMMENT_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const maskEmail = (email: string) => {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, Math.min(4, at))}***${email.slice(at)}`;
};

// 给所有站长发一条站内信；相同 type 在冷却窗口内只发一次。
// 邮件的发送结果会写进站内信正文，方便追溯「邮件到底发没发」。
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

  const email = await emailAdmins(env, admins, input);
  const emailNote = email.sent
    ? `📧 邮件已同步发送至 ${email.recipients.map(maskEmail).join("、")}`
    : email.reason
      ? `⚠️ 邮件未能发送：${email.reason}`
      : "";
  const body = emailNote ? `${input.body}\n\n${emailNote}` : input.body;

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
          body,
          input.link ?? null,
          now,
        ),
      ),
    );
  } catch {
    return false;
  }
  return true;
}

async function emailAdmins(
  env: SystemNotifyEnv,
  admins: string[],
  input: SystemNotification,
): Promise<EmailResult> {
  if (!env.RESEND_API_KEY?.trim() || !env.EMAIL_FROM?.trim()) {
    return {
      sent: false,
      recipients: [],
      reason: "未配置 RESEND_API_KEY 或 EMAIL_FROM",
    };
  }
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
    return { sent: false, recipients: [], reason: "查询管理员邮箱失败" };
  }
  if (recipients.length === 0) {
    return { sent: false, recipients: [], reason: "管理员账号未绑定邮箱" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
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
    if (!response.ok) {
      return {
        sent: false,
        recipients,
        reason: `Resend 返回 HTTP ${response.status}`,
      };
    }
    return { sent: true, recipients };
  } catch (error) {
    return {
      sent: false,
      recipients,
      reason: error instanceof Error ? error.message.slice(0, 80) : "网络异常",
    };
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
