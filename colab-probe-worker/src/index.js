// 定时探活 Colab SDXL 隧道：
//   每 15 分钟检查 /health，掉线时给站长发站内信（6 小时去重）+ 邮件。
// 收件管理员取自「历史掉线提醒」的收件人，无需单独配置站长 ID。
//
// 需要的 Secrets（wrangler secret put 设置）：
//   IMAGE_COLAB_URL —— Colab 的 ngrok 固定域名
//   RESEND_API_KEY / EMAIL_FROM —— 可选，未配置时只发站内信

const DEDUP_MS = 6 * 60 * 60 * 1000; // 同一掉线周期 6 小时内只提醒一次

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(probe(env));
  },
};

async function probe(env) {
  const base = (env.IMAGE_COLAB_URL || "").trim().replace(/\/+$/, "");
  if (!base) return "IMAGE_COLAB_URL not set";

  // 1) 探活
  let ok = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const r = await fetch(base + "/health", {
        headers: { "ngrok-skip-browser-warning": "1" },
        signal: controller.signal,
      });
      ok = r.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    ok = false;
  }
  if (ok) return "tunnel online, nothing to do";

  // 2) 去重：6 小时内已经提醒过就不重复发
  const now = Date.now();
  const recent = await env.DB.prepare(
    `SELECT id FROM notification
     WHERE type = 'colab_down' AND created_at > ?
     LIMIT 1`,
  )
    .bind(now - DEDUP_MS)
    .first();
  if (recent) return "offline, but alerted within dedup window";

  // 3) 收件管理员：历史上收到过掉线提醒的账号
  const adminRows = await env.DB.prepare(
    `SELECT DISTINCT user_id AS uid FROM notification WHERE type = 'colab_down'`,
  ).all();
  const admins = adminRows.results.map((r) => r.uid).filter(Boolean);
  if (!admins.length) return "no admin recipients known yet";

  // 4) 站内信
  const title = "GPU 生图服务掉线（定时探活）";
  const probeTime = new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
  });
  const body =
    `定时探活在 ${probeTime} 发现 Colab SDXL 服务无法连接，` +
    `AI 生图页面会显示「服务正忙」，用户积分会在失败时自动退回。` +
    `请到 Colab 重跑一键启动格恢复服务。`;

  await env.DB.batch(
    admins.map((uid) =>
      env.DB.prepare(
        `INSERT INTO notification
          (id, user_id, type, title, body, link, created_at)
         VALUES (?, ?, 'colab_down', ?, ?, '/ai-image/', ?)`,
      ).bind(crypto.randomUUID(), uid, title, body, now),
    ),
  );

  // 5) 邮件（可选）
  if (env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim()) {
    try {
      const placeholders = admins.map(() => "?").join(", ");
      const rows = await env.DB.prepare(
        `SELECT email FROM user WHERE id IN (${placeholders})`,
      )
        .bind(...admins)
        .all();
      const recipients = rows.results
        .map((r) => r.email)
        .filter((email) => Boolean(email?.trim()));
      if (recipients.length) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: recipients,
            subject: title,
            text: [
              body,
              "\n详情：https://xhz6.com/ai-image/",
              "",
              "—— 渔情站内提醒",
            ].join("\n"),
          }),
        });
      }
    } catch {
      // 邮件失败不影响站内信
    }
  }
  return `tunnel offline -> alerted ${admins.length} admin(s)`;
}
