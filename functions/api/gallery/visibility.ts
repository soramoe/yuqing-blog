import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import { isCommentAdmin } from "../../../src/lib/comment-admin";
import {
  galleryR2Keys,
  moveGalleryVariants,
} from "../../../src/lib/gallery-upload-server";
import type {
  GalleryUploadStatus,
  GalleryVisibility,
} from "../../../src/lib/gallery-upload";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

interface GalleryOwnership {
  baseName: string;
  uploaderUserId: string | null;
  status: GalleryUploadStatus;
  visibility: GalleryVisibility;
}

export const onRequestPatch: PagesFunction<Env> = async ({
  request,
  env,
}) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return json({ error: "请先登录。" }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }
  const id = (payload as { id?: unknown }).id;
  const visibility = (payload as { visibility?: unknown }).visibility;
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(id)) {
    return json({ error: "图片标识无效。" }, 400);
  }
  if (visibility !== "public" && visibility !== "private") {
    return json({ error: "图片可见性无效。" }, 400);
  }

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
    .first<GalleryOwnership>();
  if (!image) return json({ error: "图片记录不存在。" }, 404);
  if (image.status === "deleted") {
    return json({ error: "已删除的图片不能修改。" }, 409);
  }

  const isAdmin = isCommentAdmin(
    env.COMMENT_ADMIN_USER_IDS,
    session.user.id,
  );
  if (!isAdmin && image.uploaderUserId !== session.user.id) {
    return json({ error: "你不能修改这张图片的可见性。" }, 403);
  }
  if (image.visibility === visibility) {
    return json({ ok: true, visibility });
  }

  const keys = galleryR2Keys(image.baseName);
  const movingToPrivate = visibility === "private";
  try {
    await moveGalleryVariants(
      movingToPrivate ? env.MEDIA_BUCKET : env.MEDIA_PRIVATE_BUCKET,
      movingToPrivate ? env.MEDIA_PRIVATE_BUCKET : env.MEDIA_BUCKET,
      movingToPrivate ? keys.public : keys.private,
      movingToPrivate ? keys.private : keys.public,
      movingToPrivate,
    );
  } catch {
    return json(
      { error: "图片存储迁移失败，原可见性未改变，请稍后重试。" },
      500,
    );
  }

  try {
    await env.DB.prepare(
      `UPDATE gallery_upload
       SET visibility = ?, visibility_updated_at = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(visibility, Date.now(), Date.now(), id)
      .run();
  } catch {
    try {
      await moveGalleryVariants(
        movingToPrivate ? env.MEDIA_PRIVATE_BUCKET : env.MEDIA_BUCKET,
        movingToPrivate ? env.MEDIA_BUCKET : env.MEDIA_PRIVATE_BUCKET,
        movingToPrivate ? keys.private : keys.public,
        movingToPrivate ? keys.public : keys.private,
        !movingToPrivate,
      );
    } catch {
      return json(
        { error: "数据库更新失败，图片文件已迁移，请联系站长检查。" },
        500,
      );
    }
    return json({ error: "图片可见性更新失败，请稍后重试。" }, 500);
  }

  return json({ ok: true, visibility });
};

export const onRequestDelete: PagesFunction<Env> = async ({
  request,
  env,
}) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return json({ error: "请先登录。" }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }
  const id = (payload as { id?: unknown }).id;
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(id)) {
    return json({ error: "图片标识无效。" }, 400);
  }

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
    .first<GalleryOwnership>();
  if (!image) return json({ error: "图片记录不存在。" }, 404);
  if (image.status === "deleted") {
    return new Response(null, { status: 204 });
  }

  const isAdmin = isCommentAdmin(
    env.COMMENT_ADMIN_USER_IDS,
    session.user.id,
  );
  if (!isAdmin && image.uploaderUserId !== session.user.id) {
    return json({ error: "你不能删除这张图片。" }, 403);
  }

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE gallery_upload
     SET status = 'deleted', reviewed_by = ?, reviewed_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(session.user.id, now, now, id)
    .run();

  const keys = galleryR2Keys(image.baseName);
  try {
    await Promise.all([
      env.MEDIA_BUCKET.delete([...keys.public, keys.preview]),
      env.MEDIA_PRIVATE_BUCKET.delete(keys.private),
    ]);
  } catch {
    return json(
      { error: "图片记录已删除，但文件清理未完成，请联系站长重试。" },
      500,
    );
  }

  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "PATCH") return onRequestPatch(context);
  if (context.request.method === "DELETE") {
    return onRequestDelete(context);
  }
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "PATCH, DELETE" },
  });
};
