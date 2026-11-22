import type { PagesFunction } from "@cloudflare/workers-types";
import { uploadGalleryImage } from "../../../src/lib/gallery-upload-server";

export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  uploadGalleryImage(request, env, "public");

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};
