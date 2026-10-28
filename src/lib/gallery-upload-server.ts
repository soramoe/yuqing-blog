import { createAuth } from "./auth";
import { isCommentAdmin } from "./comment-admin";
import {
  GALLERY_UPLOAD_MAX_BYTES,
  GALLERY_UPLOAD_WIDTHS,
  galleryVariantUrls,
  toOnlineGalleryItem,
  type AdminGalleryItem,
  type GalleryUploadQuotaInfo,
  type GalleryUploadStatus,
  type OnlineGalleryItem,
} from "./gallery-upload";
import { chinaDateKey } from "./points";

interface GalleryUploadRow {
  id: string;
  title: string;
  baseName: string;
  width: number;
  height: number;
  source: "admin" | "public";
  status: GalleryUploadStatus;
  createdAt: number;
  uploaderName: string | null;
}

interface UploaderIdentity {
  userId: string | null;
  isAdmin: boolean;
  subjectKey: string;
  authenticated: boolean;
  dailyLimit: number;
  anonymousHash: string | null;
}

export interface ImageUploadResult {
  status: number;
  body: Record<string, unknown>;
}

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const normalizeTitle = (value: unknown, date: string) => {
  const title = typeof value === "string" ? value.trim() : "";
  return (title || `渔图 · ${date.replaceAll("-", ".")}`).slice(0, 80);
};

const clientIp = (request: Request) =>
  request.headers.get("CF-Connecting-IP")?.trim() ||
  request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
  request.headers.get("X-Real-IP")?.trim() ||
  "unknown";

const hashIp = async (ip: string, secret: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ip),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export async function getUploaderIdentity(
  request: Request,
  env: Env,
): Promise<UploaderIdentity> {
  const url = new URL(request.url);
  const auth = createAuth(env, url);
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user.id ?? null;
  const isAdmin = userId
    ? isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, userId)
    : false;

  if (userId) {
    return {
      userId,
      isAdmin,
      subjectKey: `user:${userId}`,
      authenticated: true,
      dailyLimit: 5,
      anonymousHash: null,
    };
  }

  if (!env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is not configured.");
  }
  const anonymousHash = await hashIp(
    clientIp(request),
    env.BETTER_AUTH_SECRET,
  );
  return {
    userId: null,
    isAdmin: false,
    subjectKey: `anon:${anonymousHash}`,
    authenticated: false,
    dailyLimit: 1,
    anonymousHash,
  };
}

export async function getUploadQuota(
  db: D1Database,
  identity: UploaderIdentity,
): Promise<GalleryUploadQuotaInfo> {
  const date = chinaDateKey();
  const existing = await db
    .prepare(
      `SELECT used
       FROM gallery_upload_quota
       WHERE subject_key = ? AND upload_date = ?`,
    )
    .bind(identity.subjectKey, date)
    .first<{ used: number }>();
  const used = Number(existing?.used ?? 0);
  return {
    authenticated: identity.authenticated,
    isAdmin: identity.isAdmin,
    dailyLimit: identity.dailyLimit,
    used,
    remaining: Math.max(0, identity.dailyLimit - used),
    requiresReview: true,
  };
}

async function reserveQuota(
  db: D1Database,
  identity: UploaderIdentity,
  date: string,
) {
  return db
    .prepare(
      `INSERT INTO gallery_upload_quota
        (subject_key, upload_date, used, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(subject_key, upload_date) DO UPDATE SET
         used = gallery_upload_quota.used + 1,
         updated_at = excluded.updated_at
       WHERE gallery_upload_quota.used < ?
       RETURNING used`,
    )
    .bind(identity.subjectKey, date, Date.now(), identity.dailyLimit)
    .first<{ used: number }>();
}

async function releaseQuota(
  db: D1Database,
  subjectKey: string,
  date: string,
) {
  await db
    .prepare(
      `UPDATE gallery_upload_quota
       SET used = CASE WHEN used > 0 THEN used - 1 ELSE 0 END,
           updated_at = ?
       WHERE subject_key = ? AND upload_date = ?`,
    )
    .bind(Date.now(), subjectKey, date)
    .run();
}

const isWebp = async (file: File) => {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (bytes.length < 12) return false;
  const header = String.fromCharCode(...bytes);
  return header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
};

const createUploadJson = (
  status: number,
  body: Record<string, unknown>,
) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

export async function uploadGalleryImage(
  request: Request,
  env: Env,
  mode: "public" | "admin",
): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return createUploadJson(403, { error: "请求来源不受信任。" });
  }

  const identity = await getUploaderIdentity(request, env);
  if (mode === "admin" && !identity.isAdmin) {
    return createUploadJson(
      identity.authenticated ? 403 : 401,
      { error: "只有站长可以使用专用上传入口。" },
    );
  }
  if (mode === "public" && identity.isAdmin) {
    return createUploadJson(409, {
      error: "站长请使用专用图库上传入口。",
      adminUploadUrl: "/admin/gallery/",
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return createUploadJson(400, { error: "上传内容格式无效。" });
  }

  const originalWidth = Number(form.get("width"));
  const originalHeight = Number(form.get("height"));
  if (
    !Number.isInteger(originalWidth) ||
    !Number.isInteger(originalHeight) ||
    originalWidth < 1 ||
    originalHeight < 1 ||
    originalWidth > 20_000 ||
    originalHeight > 20_000
  ) {
    return createUploadJson(400, { error: "图片尺寸无效。" });
  }

  const files: Array<{ width: number; file: File }> = [];
  let totalBytes = 0;
  for (const width of GALLERY_UPLOAD_WIDTHS) {
    const file = form.get(`variant-${width}`);
    if (!(file instanceof File)) {
      return createUploadJson(400, { error: `缺少 ${width} 宽度图片。` });
    }
    if (file.type !== "image/webp" || !(await isWebp(file))) {
      return createUploadJson(400, { error: "上传文件不是有效的 WebP 图片。" });
    }
    if (file.size > GALLERY_UPLOAD_MAX_BYTES) {
      return createUploadJson(400, { error: "单张图片文件过大。" });
    }
    totalBytes += file.size;
    files.push({ width, file });
  }
  if (totalBytes > GALLERY_UPLOAD_MAX_BYTES * 2) {
    return createUploadJson(400, { error: "图片总大小超过限制。" });
  }

  const date = chinaDateKey();
  const title = normalizeTitle(form.get("title"), date);
  if (title.length === 0) {
    return createUploadJson(400, { error: "图片标题不能为空。" });
  }

  let quotaUsed = 0;
  if (mode === "public") {
    const quota = await reserveQuota(env.DB, identity, date);
    if (!quota) {
      return createUploadJson(429, {
        error: identity.authenticated
          ? "今天最多上传 5 张图片，请明天再来。"
          : "今天的匿名上传次数已经用完，请登录后再上传。",
        quota: await getUploadQuota(env.DB, identity),
      });
    }
    quotaUsed = Number(quota.used);
  }

  const baseName = `${date.replaceAll("-", "")}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const uploadedKeys: string[] = [];
  const now = Date.now();
  const id = crypto.randomUUID();
  const status: GalleryUploadStatus =
    mode === "admin" ? "approved" : "pending";

  try {
    for (const { width, file } of files) {
      const key = `gallery/uploads/${baseName}-${width}.webp`;
      await env.MEDIA_BUCKET.put(key, await file.arrayBuffer(), {
        httpMetadata: {
          contentType: "image/webp",
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
      uploadedKeys.push(key);
    }

    await env.DB.prepare(
      `INSERT INTO gallery_upload
        (id, base_name, title, source, status, upload_date,
         uploader_user_id, anonymous_hash, width, height,
         created_at, updated_at, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        baseName,
        title,
        mode,
        status,
        date,
        identity.userId,
        identity.anonymousHash,
        originalWidth,
        originalHeight,
        now,
        now,
        mode === "admin" ? identity.userId : null,
        mode === "admin" ? now : null,
      )
      .run();
  } catch {
    if (uploadedKeys.length > 0) {
      await env.MEDIA_BUCKET.delete(uploadedKeys);
    }
    if (mode === "public") {
      await releaseQuota(env.DB, identity.subjectKey, date);
    }
    return createUploadJson(500, { error: "图片保存失败，请稍后重试。" });
  }

  const item = toOnlineGalleryItem({
    id,
    title,
    baseName,
    width: originalWidth,
    height: originalHeight,
    source: mode,
    status,
    createdAt: now,
  });
  return createUploadJson(201, {
    item,
    quota:
      mode === "public"
        ? {
            ...(await getUploadQuota(env.DB, identity)),
            dailyLimit: identity.dailyLimit,
            used: quotaUsed,
            remaining: Math.max(0, identity.dailyLimit - quotaUsed),
          }
        : null,
    requiresReview: mode === "public",
  });
}

export async function listApprovedGalleryUploads(
  db: D1Database,
): Promise<OnlineGalleryItem[]> {
  const result = await db
    .prepare(
      `SELECT
        id,
        title,
        base_name AS baseName,
        width,
        height,
        source,
        status,
        created_at AS createdAt
      FROM gallery_upload
      WHERE status = 'approved'
      ORDER BY created_at DESC, id DESC
      LIMIT 200`,
    )
    .all<GalleryUploadRow>();
  return result.results.map(toOnlineGalleryItem);
}

export async function listAdminGalleryUploads(
  db: D1Database,
  status: string,
): Promise<AdminGalleryItem[]> {
  const where =
    status === "all" ? "1 = 1" : "g.status = ?";
  const statement = db.prepare(
    `SELECT
      g.id,
      g.title,
      g.base_name AS baseName,
      g.width,
      g.height,
      g.source,
      g.status,
      g.created_at AS createdAt,
      g.reviewed_at AS reviewedAt,
      u.name AS uploaderName
    FROM gallery_upload g
    LEFT JOIN user u ON u.id = g.uploader_user_id
    WHERE ${where}
    ORDER BY g.created_at DESC, g.id DESC
    LIMIT 100`,
  );
  const result = await (
    status === "all" ? statement : statement.bind(status)
  ).all<GalleryUploadRow & { reviewedAt: number | null }>();

  return result.results.map((row) => ({
    ...toOnlineGalleryItem(row),
    baseName: row.baseName,
    uploaderType:
      row.source === "admin"
        ? "admin"
        : row.uploaderName
          ? "user"
          : "anonymous",
    uploaderName:
      row.source === "admin"
        ? "站长"
        : row.uploaderName || "匿名投稿",
    reviewedAt: row.reviewedAt ? Number(row.reviewedAt) : null,
  }));
}
