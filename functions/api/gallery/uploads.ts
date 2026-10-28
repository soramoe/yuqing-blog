import type { PagesFunction } from "@cloudflare/workers-types";
import { listApprovedGalleryUploads } from "../../../src/lib/gallery-upload-server";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const images = await listApprovedGalleryUploads(env.DB);
  return new Response(JSON.stringify({ images }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};
