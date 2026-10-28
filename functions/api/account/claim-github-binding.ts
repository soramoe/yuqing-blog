import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import {
  BINDING_REWARD,
  awardBindingPoints,
  hasBindingReward,
} from "../../../src/lib/binding-rewards";

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

  if (await hasBindingReward(env.DB, session.user.id, "github")) {
    return json({ awarded: false, amount: 0, alreadyClaimed: true });
  }

  const githubAccount = await env.DB.prepare(
    `SELECT created_at AS createdAt
     FROM account
     WHERE user_id = ? AND provider_id = 'github'
     LIMIT 1`,
  )
    .bind(session.user.id)
    .first<{ createdAt: number }>();
  if (!githubAccount) {
    return json({ error: "当前账号还没有绑定 GitHub。" }, 400);
  }

  const userCreatedAt = new Date(session.user.createdAt).getTime();
  if (Number(githubAccount.createdAt) - userCreatedAt <= 5_000) {
    return json({
      awarded: false,
      amount: 0,
      reason: "GitHub 是账号的初始登录方式。",
    });
  }

  const result = await awardBindingPoints(
    env.DB,
    session.user.id,
    "github",
    "绑定 GitHub 奖励",
  );
  return json({
    ...result,
    amount: result.awarded ? BINDING_REWARD : 0,
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};
