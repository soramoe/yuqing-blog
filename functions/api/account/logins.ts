import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import { hasBindingReward } from "../../../src/lib/binding-rewards";

interface AccountRow {
  providerId: string;
  createdAt: number;
  hasPassword: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "请先登录。" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const accountsResult = await env.DB.prepare(
    `SELECT
       provider_id AS providerId,
       created_at AS createdAt,
       CASE WHEN password IS NOT NULL AND password != '' THEN 1 ELSE 0 END
         AS hasPassword
     FROM account
     WHERE user_id = ?
     ORDER BY created_at`,
  )
    .bind(session.user.id)
    .all<AccountRow>();
  const githubAccount = accountsResult.results.find(
    (account) => account.providerId === "github",
  );
  const credentialAccount = accountsResult.results.find(
    (account) => account.providerId === "credential",
  );
  const [emailReward, githubReward] = await Promise.all([
    hasBindingReward(env.DB, session.user.id, "email"),
    hasBindingReward(env.DB, session.user.id, "github"),
  ]);

  const linkedLater =
    githubAccount &&
    Number(githubAccount.createdAt) - new Date(session.user.createdAt).getTime() >
      5_000;

  return new Response(
    JSON.stringify({
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      hasPassword: Boolean(credentialAccount?.hasPassword),
      hasGitHub: Boolean(githubAccount),
      githubLinkedLater: Boolean(linkedLater),
      emailBindingRewardClaimed: emailReward,
      githubBindingRewardClaimed: githubReward,
      canBindEmail: Boolean(githubAccount) && !emailReward,
      canLinkGitHub: !githubAccount,
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};
