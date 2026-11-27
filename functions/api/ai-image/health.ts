import type { PagesFunction } from "@cloudflare/workers-types";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const upstreamBase = env.IMAGE_COLAB_URL?.trim().replace(/\/+$/, "");
  if (!upstreamBase) {
    return json({ ok: false, reason: "not_configured" }, 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(upstreamBase + "/health", {
      signal: controller.signal,
      headers: { "ngrok-skip-browser-warning": "1" },
    });
    return json({ ok: response.ok }, response.ok ? 200 : 503);
  } catch {
    return json({ ok: false, reason: "offline" }, 503);
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
