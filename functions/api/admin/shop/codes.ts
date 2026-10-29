import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { isCommentAdmin } from "../../../../src/lib/comment-admin";
import {
  generateRedemptionCode,
  hashRedemptionCode,
  maskRedemptionCode,
} from "../../../../src/lib/shop";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return json({ error: "请先登录。" }, 401);
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return json({ error: "你没有生成兑换码的权限。" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }
  const input = payload as { amount?: unknown; count?: unknown };
  const amount =
    typeof input.amount === "number" ? Math.trunc(input.amount) : NaN;
  const count =
    typeof input.count === "number" ? Math.trunc(input.count) : NaN;

  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000) {
    return json({ error: "积分数量必须是 1 到 100000 的整数。" }, 400);
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) {
    return json({ error: "每次可以生成 1 到 20 个兑换码。" }, 400);
  }

  const now = Date.now();
  const batchId = crypto.randomUUID();
  const codes: Array<{
    code: string;
    mask: string;
    id: string;
  }> = [];
  const statements: D1PreparedStatement[] = [];

  for (let index = 0; index < count; index += 1) {
    const code = generateRedemptionCode();
    const codeHash = await hashRedemptionCode(code);
    const id = crypto.randomUUID();
    codes.push({ code, mask: maskRedemptionCode(code), id });
    statements.push(
      env.DB.prepare(
        `INSERT INTO point_redemption_code
          (id, code_hash, code_hint, amount, batch_id,
           created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        codeHash,
        maskRedemptionCode(code),
        amount,
        batchId,
        session.user.id,
        now + index,
      ),
    );
  }

  try {
    await env.DB.batch(statements);
  } catch {
    return json({ error: "兑换码生成失败，请重试。" }, 500);
  }

  return json(
    {
      ok: true,
      batchId,
      amount,
      codes,
      warning: "兑换码明文只显示这一次，请立即复制或下载保存。",
    },
    201,
  );
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};
