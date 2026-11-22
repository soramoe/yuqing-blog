import { chinaDateKey } from "./points";
import {
  getImageSettings,
  type ImageFeature,
  type ImagePermission,
  type ImageQuality,
} from "./image-settings";
import {
  routeImageGeneration,
  type ImageRouterEnv,
  ImageRoutingError,
} from "./image-router";

export interface CreateImageJobInput {
  userId: string;
  requestId: string;
  feature: ImageFeature;
  sourceId?: string;
  prompt: string;
  englishPrompt?: string;
  negativePrompt?: string;
  quality: ImageQuality;
  aspectRatio?: string;
  permission?: ImagePermission;
}

export interface ImageJobResult {
  id: string;
  status: "succeeded";
  providerId: string;
  providerName: string;
  model: string;
  r2Key: string;
  contentType: string;
  width: number;
  height: number;
  pointsCost: number;
  balance: number;
  attempts: number;
}

interface ImageServiceEnv extends ImageRouterEnv {
  MEDIA_BUCKET: R2Bucket;
  MEDIA_PRIVATE_BUCKET: R2Bucket;
}

export class ImageServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly balance?: number,
  ) {
    super(message);
    this.name = "ImageServiceError";
  }
}

const allowedFeatures: ImageFeature[] = [
  "story_chapter",
  "image_studio",
  "admin_test",
];
const allowedRatios = ["1:1", "4:5", "16:9"] as const;

const dimensions = (
  quality: ImageQuality,
  aspectRatio: (typeof allowedRatios)[number],
) => {
  const table = {
    standard: {
      "1:1": [1024, 1024],
      "4:5": [864, 1080],
      "16:9": [1280, 720],
    },
    hd: {
      "1:1": [1328, 1328],
      "4:5": [1056, 1320],
      "16:9": [1536, 864],
    },
  } as const;
  const [width, height] = table[quality][aspectRatio];
  return { width, height };
};

const extensionFor = (contentType: string) => {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "png";
};

async function chargeImageJob(
  db: D1Database,
  userId: string,
  requestId: string,
  points: number,
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT OR IGNORE INTO point_account (user_id, balance, updated_at)
       VALUES (?, 0, ?)`,
    )
    .bind(userId, now)
    .run();
  const deducted = await db
    .prepare(
      `UPDATE point_account
       SET balance = balance - ?, updated_at = ?
       WHERE user_id = ? AND balance >= ?
       RETURNING balance`,
    )
    .bind(points, now, userId, points)
    .first<{ balance: number }>();
  if (!deducted) {
    const account = await db
      .prepare("SELECT balance FROM point_account WHERE user_id = ?")
      .bind(userId)
      .first<{ balance: number }>();
    throw new ImageServiceError(
      `积分不足，本次生图需要 ${points} 积分。`,
      402,
      Number(account?.balance ?? 0),
    );
  }
  try {
    await db
      .prepare(
        `INSERT INTO point_transaction
          (id, user_id, amount, type, description, reference_id,
           balance_after, created_at)
         VALUES (?, ?, ?, 'image_generation', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        -points,
        `AI 图片生成（${points} 积分）`,
        `image:job:${requestId}`,
        deducted.balance,
        now,
      )
      .run();
  } catch {
    await db
      .prepare(
        `UPDATE point_account
         SET balance = balance + ?, updated_at = ?
         WHERE user_id = ?`,
      )
      .bind(points, Date.now(), userId)
      .run();
    throw new ImageServiceError("生图积分扣费失败，请稍后重试。", 500);
  }
  return Number(deducted.balance);
}

async function refundImageJob(
  db: D1Database,
  userId: string,
  requestId: string,
  points: number,
) {
  const now = Date.now();
  const updated = await db
    .prepare(
      `UPDATE point_account
       SET balance = balance + ?, updated_at = ?
       WHERE user_id = ?
       RETURNING balance`,
    )
    .bind(points, now, userId)
    .first<{ balance: number }>();
  if (!updated) return 0;
  try {
    await db
      .prepare(
        `INSERT INTO point_transaction
          (id, user_id, amount, type, description, reference_id,
           balance_after, created_at)
         VALUES (?, ?, ?, 'image_refund', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        points,
        "AI 图片生成失败退款",
        `image:refund:${requestId}`,
        updated.balance,
        now,
      )
      .run();
  } catch {
    // The balance is already restored. A duplicate reference must not cause
    // another refund.
  }
  return Number(updated.balance);
}

async function existingJob(
  db: D1Database,
  userId: string,
  requestId: string,
) {
  return db
    .prepare(
      `SELECT
        j.id,
        j.status,
        j.error_message AS errorMessage,
        a.provider_id AS providerId,
        a.model,
        a.r2_key AS r2Key,
        a.content_type AS contentType,
        a.width,
        a.height,
        j.points_cost AS pointsCost,
        j.balance_after AS balance
       FROM image_job j
       LEFT JOIN image_asset a ON a.job_id = j.id
       WHERE j.user_id = ? AND j.request_id = ?`,
    )
    .bind(userId, requestId)
    .first<{
      id: string;
      status: string;
      errorMessage: string | null;
      providerId: string | null;
      model: string | null;
      r2Key: string | null;
      contentType: string | null;
      width: number | null;
      height: number | null;
      pointsCost: number;
      balance: number | null;
    }>();
}

export async function createAndRunImageJob(
  env: ImageServiceEnv,
  input: CreateImageJobInput,
) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId)) {
    throw new ImageServiceError("生图请求标识无效。", 400);
  }
  if (!allowedFeatures.includes(input.feature)) {
    throw new ImageServiceError("生图功能类型无效。", 400);
  }
  if (input.feature === "story_chapter" && !input.sourceId?.trim()) {
    throw new ImageServiceError("章节生图缺少章节标识。", 400);
  }
  const prompt = input.prompt.trim().slice(0, 3000);
  const negativePrompt = (input.negativePrompt ?? "").trim().slice(0, 1000);
  if (prompt.length < 6) {
    throw new ImageServiceError("图片描述过短。", 400);
  }
  const quality: ImageQuality =
    input.quality === "hd" ? "hd" : "standard";
  const ratio = allowedRatios.includes(
    (input.aspectRatio ?? "1:1") as (typeof allowedRatios)[number],
  )
    ? ((input.aspectRatio ?? "1:1") as (typeof allowedRatios)[number])
    : "1:1";
  const permission: ImagePermission =
    input.permission === "public" ? "public" : "private";
  const settings = await getImageSettings(env.DB);
  if (!settings.enabled) {
    throw new ImageServiceError("生图功能当前未开放。", 503);
  }

  const previous = await existingJob(env.DB, input.userId, input.requestId);
  if (previous) {
    if (previous.status === "succeeded" && previous.r2Key) {
      return {
        id: previous.id,
        status: "succeeded",
        providerId: previous.providerId ?? "",
        providerName: previous.providerId ?? "",
        model: previous.model ?? "",
        r2Key: previous.r2Key,
        contentType: previous.contentType ?? "image/png",
        width: Number(previous.width ?? 0),
        height: Number(previous.height ?? 0),
        pointsCost: Number(previous.pointsCost),
        balance: Number(previous.balance ?? 0),
        attempts: 0,
      } satisfies ImageJobResult;
    }
    if (previous.status === "pending" || previous.status === "processing") {
      throw new ImageServiceError("该生图请求正在处理中。", 409);
    }
    throw new ImageServiceError(
      previous.errorMessage || "该生图请求已经结束，请重新发起。",
      409,
      previous.balance ?? undefined,
    );
  }

  if (input.sourceId) {
    const activeSource = await env.DB.prepare(
      `SELECT id, status
       FROM image_job
       WHERE user_id = ? AND feature = ? AND source_id = ?
         AND status IN ('pending', 'processing', 'succeeded')
       LIMIT 1`,
    )
      .bind(input.userId, input.feature, input.sourceId)
      .first<{ id: string; status: string }>();
    if (activeSource) {
      throw new ImageServiceError(
        activeSource.status === "succeeded"
          ? "这个章节已经生成过图片。"
          : "这个章节的图片正在生成中。",
        409,
      );
    }
  }

  const todayJobs = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM image_job
     WHERE date(created_at / 1000, 'unixepoch', '+8 hours') = ?`,
  )
    .bind(chinaDateKey())
    .first<{ total: number }>();
  if (Number(todayJobs?.total ?? 0) >= settings.dailyJobLimit) {
    throw new ImageServiceError("今天的全站生图次数已经用完。", 429);
  }

  const jobId = crypto.randomUUID();
  const pointsCost =
    quality === "hd" ? settings.hdPoints : settings.standardPoints;
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO image_job
        (id, request_id, user_id, feature, source_id, prompt,
         negative_prompt, quality, aspect_ratio, points_cost,
         status, permission, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, ?)`,
    )
      .bind(
        jobId,
        input.requestId,
        input.userId,
        input.feature,
        input.sourceId?.slice(0, 200) ?? null,
        prompt,
        negativePrompt,
        quality,
        ratio,
        pointsCost,
        permission,
        now,
        now,
      )
      .run();
  } catch {
    const raced = await existingJob(env.DB, input.userId, input.requestId);
    if (raced) throw new ImageServiceError("该生图请求已经存在。", 409);
    throw new ImageServiceError("生图任务创建失败。", 500);
  }

  let balance = 0;
  try {
    balance = await chargeImageJob(
      env.DB,
      input.userId,
      input.requestId,
      pointsCost,
    );
  } catch (error) {
    await env.DB.prepare(
      `UPDATE image_job
       SET status = 'failed', error_code = 'charge-failed',
           error_message = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        error instanceof Error ? error.message.slice(0, 500) : "扣费失败",
        Date.now(),
        Date.now(),
        jobId,
      )
      .run();
    throw error;
  }

  await env.DB.prepare(
    `UPDATE image_job
     SET status = 'processing', balance_after = ?, started_at = ?,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(balance, Date.now(), Date.now(), jobId)
    .run();

  const { width, height } = dimensions(quality, ratio);
  try {
    const generated = await routeImageGeneration(env, jobId, {
      prompt,
      englishPrompt: input.englishPrompt?.trim().slice(0, 2000),
      negativePrompt,
      width,
      height,
      quality,
    });
    await env.DB.prepare(
      "UPDATE image_job SET attempts = ? WHERE id = ?",
    )
      .bind(generated.attempts, jobId)
      .run();

    const extension = extensionFor(generated.contentType);
    const date = new Date();
    const r2Key = `ai/images/${date.getUTCFullYear()}/${String(
      date.getUTCMonth() + 1,
    ).padStart(2, "0")}/${jobId}.${extension}`;
    const bucket =
      permission === "public"
        ? env.MEDIA_BUCKET
        : env.MEDIA_PRIVATE_BUCKET;
    await bucket.put(r2Key, generated.bytes, {
      httpMetadata: {
        contentType: generated.contentType,
        cacheControl:
          permission === "public"
            ? "public, max-age=31536000, immutable"
            : "private, no-store",
      },
      customMetadata: {
        jobId,
        userId: input.userId,
        providerId: generated.providerId,
        model: generated.model,
      },
    });

    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO image_asset
            (id, job_id, user_id, provider_id, model, r2_key,
             content_type, width, height, size_bytes, prompt, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          jobId,
          input.userId,
          generated.providerId,
          generated.model,
          r2Key,
          generated.contentType,
          generated.width,
          generated.height,
          generated.bytes.byteLength,
          prompt,
          Date.now(),
        ),
        env.DB.prepare(
          `UPDATE image_job
           SET status = 'succeeded', provider_id = ?, model = ?,
               completed_at = ?, updated_at = ?
           WHERE id = ?`,
        ).bind(
          generated.providerId,
          generated.model,
          Date.now(),
          Date.now(),
          jobId,
        ),
      ]);
    } catch {
      await bucket.delete(r2Key);
      throw new ImageServiceError("图片保存失败，积分已退回。", 500);
    }

    return {
      id: jobId,
      status: "succeeded",
      providerId: generated.providerId,
      providerName: generated.providerName,
      model: generated.model,
      r2Key,
      contentType: generated.contentType,
      width: generated.width,
      height: generated.height,
      pointsCost,
      balance,
      attempts: generated.attempts,
    } satisfies ImageJobResult;
  } catch (error) {
    const message =
      error instanceof ImageRoutingError
        ? error.message
        : error instanceof Error
          ? error.message
          : "图片生成失败。";
    const refundedBalance = await refundImageJob(
      env.DB,
      input.userId,
      input.requestId,
      pointsCost,
    );
    await env.DB.prepare(
      `UPDATE image_job
       SET status = 'failed', error_code = 'generation-failed',
           error_message = ?, balance_after = ?, completed_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        message.slice(0, 500),
        refundedBalance || balance + pointsCost,
        Date.now(),
        Date.now(),
        jobId,
      )
      .run();
    throw new ImageServiceError(
      `${message} 本次生图积分已退回。`,
      503,
      refundedBalance || balance + pointsCost,
    );
  }
}
