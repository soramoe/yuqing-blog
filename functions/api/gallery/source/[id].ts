import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { isCommentAdmin } from "../../../../src/lib/comment-admin";
import {
  galleryPrivateKeys,
  galleryOriginalKeys,
  type GalleryVisibility,
} from "../../../../src/lib/gallery-upload";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

interface SourceRow {
  baseName: string;
  uploaderUserId: string | null;
  status: string;
  visibility: GalleryVisibility;
}

export const onRequestGet: PagesFunction<
  Env,
  string,
  { id: string }
> = async ({ request, env, params }) => {
  const id = String(params.id ?? "");
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) {
    return json({ error: "图片标识无效。" }, 400);
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return json({ error: "请先登录。" }, 401);

  const image = await env.DB.prepare(
    `SELECT
      base_name AS baseName,
      uploader_user_id AS uploaderUserId,
      status,
      visibility
    FROM gallery_upload
    WHERE id = ?`,
  )
    .bind(id)
    .first<SourceRow>();
  if (!image || image.status === "deleted") {
    return json({ error: "图片不存在。" }, 404);
  }

  const isAdmin = isCommentAdmin(
    env.COMMENT_ADMIN_USER_IDS,
    session.user.id,
  );
  if (!isAdmin && image.uploaderUserId !== session.user.id) {
    return json({ error: "你没有查看这张原图的权限。" }, 403);
  }

  const requestedVariant = Number(
    new URL(request.url).searchParams.get("variant") ?? 960,
  );
  if (![480, 960, 1920].includes(requestedVariant)) {
    return json({ error: "图片尺寸无效。" }, 400);
  }

  const isPrivate = image.visibility === "private";
  const keys = isPrivate
    ? galleryPrivateKeys(image.baseName)
    : galleryOriginalKeys(image.baseName);
  const key = keys[[480, 960, 1920].indexOf(requestedVariant)];
  const object = await (isPrivate
    ? env.MEDIA_PRIVATE_BUCKET
    : env.MEDIA_BUCKET
  ).get(key);
  if (!object) return json({ error: "图片文件不存在。" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
};

export const onRequest: PagesFunction<
  Env,
  string,
  { id: string }
> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};
