interface EmailEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

interface OtpEmail {
  email: string;
  otp: string;
  purpose: "login" | "bind-email";
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export async function sendOtpEmail(env: EmailEnv, input: OtpEmail) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error("Email service is not configured.");
  }

  const action =
    input.purpose === "login" ? "登录渔情" : "绑定渔情邮箱";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [input.email],
      subject: `${action}验证码`,
      text: [
        `你的${action}验证码是：${input.otp}`,
        "",
        "验证码 10 分钟内有效。",
        "如果不是你本人操作，请忽略这封邮件。",
        "",
        "渔情",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,'Microsoft YaHei',sans-serif;max-width:520px;margin:0 auto;padding:28px;color:#171717">
          <p style="margin:0 0 18px;color:#6c6f6a;font-size:12px;letter-spacing:.08em">YQ / AUTH</p>
          <h1 style="margin:0 0 18px;font-size:28px">${escapeHtml(action)}</h1>
          <p style="line-height:1.7">请输入下面的验证码：</p>
          <p style="margin:24px 0;padding:16px 20px;border:1px solid #d8dad5;background:#f5f5f3;font-size:32px;font-weight:700;letter-spacing:.18em;text-align:center">${input.otp}</p>
          <p style="color:#6c6f6a;font-size:13px;line-height:1.7">验证码 10 分钟内有效。如果不是你本人操作，请忽略这封邮件。</p>
          <p style="margin-top:28px;color:#6c6f6a;font-size:13px">渔情</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(`Email delivery failed with status ${response.status}.`);
  }
}
