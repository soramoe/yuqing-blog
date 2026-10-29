import type { PagesFunction } from "@cloudflare/workers-types";
import {
  getUploaderIdentity,
  listOwnedGalleryUploads,
} from "../../../src/lib/gallery-upload-server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const identity = await getUploaderIdentity(request, env);
  if (!identity.userId) return json({ error: "请先登录。" }, 401);
  return json({
    images: await listOwnedGalleryUploads(env.DB, identity.userId),
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};
