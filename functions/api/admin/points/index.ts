import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { isCommentAdmin, escapeLike } from "../../../../src/lib/comment-admin";
import type {
  AdminPointAction,
  AdminPointUser,
  AdminPointsResponse,
} from "../../../../src/lib/admin-points";

interface UserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  balance: number;
  totalEarned: number;
  createdAt: number;
}

interface ActionRow {
  id: string;
  amount: number;
  type: string;
  description: string;
  balanceAfter: number;
  createdAt: number;
  targetName: string;
  operatorName: string | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "请先登录。" }, 401);
  }
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return json({ error: "你没有积分管理权限。" }, 403);
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const where = query
    ? "WHERE u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!'"
    : "";
  const term = `%${escapeLike(query)}%`;
  const userValues = query ? [term, term] : [];

  const [usersResult, actionsResult] = await Promise.all([
    env.DB.prepare(
      `SELECT
        u.id,
        u.name,
        u.email,
        u.image,
        u.created_at AS createdAt,
        COALESCE(a.balance, 0) AS balance,
        COALESCE(
          (
            SELECT SUM(t.amount)
            FROM point_transaction t
            WHERE t.user_id = u.id AND t.amount > 0
          ),
          0
        ) AS totalEarned
      FROM user u
      LEFT JOIN point_account a ON a.user_id = u.id
      ${where}
      ORDER BY u.created_at DESC
      LIMIT 50`,
    )
      .bind(...userValues)
      .all<UserRow>(),
    env.DB.prepare(
      `SELECT
        t.id,
        t.amount,
        t.type,
        t.description,
        t.balance_after AS balanceAfter,
        t.created_at AS createdAt,
        target.name AS targetName,
        operator.name AS operatorName
      FROM point_transaction t
      INNER JOIN user target ON target.id = t.user_id
      LEFT JOIN user operator ON operator.id = t.operator_user_id
      WHERE t.type IN ('admin_credit', 'admin_debit')
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 20`,
    ).all<ActionRow>(),
  ]);

  const response: AdminPointsResponse = {
    users: usersResult.results.map<AdminPointUser>((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      image: row.image,
      balance: Number(row.balance),
      totalEarned: Number(row.totalEarned),
      createdAt: Number(row.createdAt),
    })),
    recentActions: actionsResult.results.map<AdminPointAction>((row) => ({
      id: row.id,
      amount: Number(row.amount),
      type: row.type,
      description: row.description,
      balanceAfter: Number(row.balanceAfter),
      createdAt: Number(row.createdAt),
      targetName: row.targetName,
      operatorName: row.operatorName,
    })),
  };

  return json(response);
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};
