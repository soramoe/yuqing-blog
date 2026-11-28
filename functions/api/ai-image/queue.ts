import type { PagesFunction } from "@cloudflare/workers-types";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const colabBase = (env: Env) =>
  env.IMAGE_COLAB_URL?.trim().replace(/\/+$/, "") ?? "";

// 排队状态代理：前端据此显示「GPU 忙碌中 · 前方 N 人」和插队入口
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const base = colabBase(env);
  if (!base) {
    return json({ offline: true, busy: false, waiting: 0, vip: 0 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${base}/queue`, {
      signal: controller.signal,
      headers: { "ngrok-skip-browser-warning": "1" },
    });
    if (!response.ok) {
      return json({ offline: true, busy: false, waiting: 0, vip: 0 });
    }
    const payload = (await response.json()) as {
      busy?: boolean;
      waiting?: number;
      vip?: number;
    };
    return json({
      offline: false,
      busy: Boolean(payload.busy),
      waiting: Number(payload.waiting ?? 0),
      vip: Number(payload.vip ?? 0),
    });
  } catch {
    return json({ offline: true, busy: false, waiting: 0, vip: 0 });
  } finally {
    clearTimeout(timeout);
  }
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};
