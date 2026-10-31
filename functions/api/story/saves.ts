import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const sameOrigin = (request: Request) => {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
};

const stripSecrets = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/api.?key/i.test(key)) continue;
    output[key] = stripSecrets(item);
  }
  return output;
};

const authorize = async (request: Request, env: Env) => {
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return { response: json({ error: "请先登录。" }, 401) };
  }
  return { session };
};

const listSaves = async (db: D1Database, userId: string) => {
  const result = await db
    .prepare(
      `SELECT
        slot,
        title,
        turn_index AS turnIndex,
        data_json AS dataJson,
        updated_at AS updatedAt
       FROM story_cloud_save
       WHERE user_id = ?
       ORDER BY slot ASC`,
    )
    .bind(userId)
    .all<{
      slot: number;
      title: string;
      turnIndex: number;
      dataJson: string;
      updatedAt: number;
    }>();
  return result.results.map((row) => {
    let data: unknown = null;
    try {
      data = JSON.parse(row.dataJson);
    } catch {
      data = null;
    }
    return {
      slot: Number(row.slot),
      title: row.title,
      turnIndex: Number(row.turnIndex),
      updatedAt: Number(row.updatedAt),
      data,
    };
  });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const authorized = await authorize(request, env);
  if ("response" in authorized) return authorized.response;
  return json({
    saves: await listSaves(env.DB, authorized.session.user.id),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({
  request,
  env,
}) => {
  if (!sameOrigin(request)) {
    return json({ error: "请求来源不受信任。" }, 403);
  }
  const authorized = await authorize(request, env);
  if ("response" in authorized) return authorized.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "存档内容格式无效。" }, 400);
  }
  const input = payload as {
    slot?: unknown;
    title?: unknown;
    data?: unknown;
  };
  const slot = Number(input.slot);
  const title =
    typeof input.title === "string" ? input.title.trim().slice(0, 80) : "";
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) {
    return json({ error: "云存档位置无效。" }, 400);
  }
  if (!input.data || typeof input.data !== "object") {
    return json({ error: "没有可保存的故事数据。" }, 400);
  }
  const data = stripSecrets(input.data) as Record<string, unknown>;
  const dataJson = JSON.stringify(data);
  if (new TextEncoder().encode(dataJson).byteLength > 900_000) {
    return json({ error: "故事数据过大，暂时无法保存到云端。" }, 413);
  }
  const sessionId =
    typeof data.sessionId === "string" ? data.sessionId.slice(0, 80) : "";
  const turnIndex = Number(data.turnIndex);
  if (!sessionId) return json({ error: "存档缺少会话标识。" }, 400);

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO story_cloud_save
      (id, user_id, slot, title, session_id, turn_index,
       data_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, slot) DO UPDATE SET
       title = excluded.title,
       session_id = excluded.session_id,
       turn_index = excluded.turn_index,
       data_json = excluded.data_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      crypto.randomUUID(),
      authorized.session.user.id,
      slot,
      title || "未命名互动故事",
      sessionId,
      Number.isInteger(turnIndex) ? turnIndex : 0,
      dataJson,
      now,
      now,
    )
    .run();
  return json({ ok: true, saves: await listSaves(env.DB, authorized.session.user.id) });
};

export const onRequestDelete: PagesFunction<Env> = async ({
  request,
  env,
}) => {
  if (!sameOrigin(request)) {
    return json({ error: "请求来源不受信任。" }, 403);
  }
  const authorized = await authorize(request, env);
  if ("response" in authorized) return authorized.response;
  const slot = Number(new URL(request.url).searchParams.get("slot"));
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) {
    return json({ error: "云存档位置无效。" }, 400);
  }
  await env.DB.prepare(
    "DELETE FROM story_cloud_save WHERE user_id = ? AND slot = ?",
  )
    .bind(authorized.session.user.id, slot)
    .run();
  return json({ ok: true, saves: await listSaves(env.DB, authorized.session.user.id) });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, POST, DELETE" },
  });
};
