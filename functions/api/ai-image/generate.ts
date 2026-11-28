import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import {
  createAndRunImageJob,
  ImageServiceError,
  isImageAspectRatio,
} from "../../../src/lib/image-service";
import { getImageSettings, listImageProviders } from "../../../src/lib/image-settings";
import {
  isProviderConfigured,
  providerNeedsEnglishPrompt,
  providerSupportsInitImage,
} from "../../../src/lib/image-providers";
import { notifyColabDown } from "../../../src/lib/system-notify";
import { gtxTranslate, translateImagePrompt } from "../../../src/lib/translate";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const safeText = (value: unknown, maximum: number) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";

// 参考图走 JSON body 传 data URL：页面限制 8MB 原图，base64 后约 10.7MB 字符
const MAX_INIT_IMAGE_CHARS = 12_000_000;
const INIT_IMAGE_PATTERN = /^data:image\/(png|jpeg|webp);base64,/i;

const parseInitImage = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (
    raw.length < 64 ||
    raw.length > MAX_INIT_IMAGE_CHARS ||
    !INIT_IMAGE_PATTERN.test(raw)
  ) {
    return null;
  }
  return raw;
};

const colabBase = (env: Env) =>
  env.IMAGE_COLAB_URL?.trim().replace(/\/+$/, "") ?? "";

// 插队费：与生图费分开预扣，生成失败自动退回
async function chargeQueueJump(
  db: D1Database,
  userId: string,
  requestId: string,
  points: number,
) {
  const now = Date.now();
  const deducted = await db
    .prepare(
      `UPDATE point_account SET balance = balance - ?, updated_at = ?
       WHERE user_id = ? AND balance >= ? RETURNING balance`,
    )
    .bind(points, now, userId, points)
    .first<{ balance: number }>();
  if (!deducted) {
    const account = await db
      .prepare("SELECT balance FROM point_account WHERE user_id = ?")
      .bind(userId)
      .first<{ balance: number }>();
    throw new ImageServiceError(
      `插队需要 ${points} 积分，余额不足。`,
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
         VALUES (?, ?, ?, 'queue_jump', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        -points,
        `生图插队（${points} 积分）`,
        `image:jump:${requestId}`,
        deducted.balance,
        now,
      )
      .run();
  } catch {
    await db
      .prepare(
        `UPDATE point_account SET balance = balance + ?, updated_at = ?
         WHERE user_id = ?`,
      )
      .bind(points, Date.now(), userId)
      .run();
    throw new ImageServiceError("插队积分扣费失败，请稍后重试。", 500);
  }
  return Number(deducted.balance);
}

async function refundQueueJump(
  db: D1Database,
  userId: string,
  requestId: string,
  points: number,
) {
  const now = Date.now();
  const updated = await db
    .prepare(
      `UPDATE point_account SET balance = balance + ?, updated_at = ?
       WHERE user_id = ? RETURNING balance`,
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
         VALUES (?, ?, ?, 'queue_jump_refund', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        points,
        "生图插队退款",
        `image:jump-refund:${requestId}`,
        updated.balance,
        now,
      )
      .run();
  } catch {
    // 余额已恢复，重复引用不重复退款
  }
  return Number(updated.balance);
}

// 探活 + 配置：返回可用模型列表（含各自状态），供页面渲染模型选择卡片
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const settings = await getImageSettings(env.DB);
  const providers = await listImageProviders(env.DB);
  const base = colabBase(env);
  let ok = false;
  if (base) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${base}/health`, {
        signal: controller.signal,
        headers: { "ngrok-skip-browser-warning": "1" },
      });
      ok = response.ok;
    } catch {
      ok = false;
    } finally {
      clearTimeout(timeout);
    }
  }
  const now = Date.now();
  const models = providers
    .filter((p) => {
      if (!p.enabled) return false;
      const list = p.features.split(",").map((s) => s.trim());
      return list.includes("image_studio");
    })
    .map((p) => {
      let status = "ready";
      if (p.adapter === "colab-sdxl") {
        status = ok
          ? p.cooldownUntil && p.cooldownUntil > now
            ? "cooldown"
            : "ready"
          : "offline";
      } else if (!isProviderConfigured(env, p)) {
        status = "unconfigured";
      } else if (p.cooldownUntil && p.cooldownUntil > now) {
        status = "cooldown";
      }
      return {
        id: p.id,
        name: p.name,
        model: p.model,
        adapter: p.adapter,
        status,
        supportsInitImage: providerSupportsInitImage(p.adapter),
      };
    });
  const provider = await env.DB.prepare(
    `SELECT consecutive_failures AS failures, cooldown_until AS cooldownUntil
     FROM image_provider WHERE id = 'colab-sdxl'`,
  ).first<{ failures: number; cooldownUntil: number | null }>();
  const cooldownUntil = provider?.cooldownUntil
    ? Number(provider.cooldownUntil)
    : 0;
  const cooldownSeconds =
    cooldownUntil > now ? Math.ceil((cooldownUntil - now) / 1000) : 0;
  return json({
    ok,
    configured: Boolean(base),
    enabled: settings.enabled,
    points: settings.studioPoints,
    pointsHd: settings.studioHdPoints,
    queueJumpPoints: settings.queueJumpPoints,
    failures: Number(provider?.failures ?? 0),
    cooldownSeconds,
    models,
  });
};

export const onRequestPost: PagesFunction<Env> = async ({
  request,
  env,
  waitUntil,
}) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "请先登录后再生图。", code: "auth" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "生图参数格式无效。" }, 400);
  }
  const input =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  const requestId = safeText(input.requestId, 80);
  const prompt = safeText(input.prompt, 800);
  const prompt2 = safeText(input.prompt_2, 800);
  const negativePrompt = safeText(input.negative_prompt, 500);
  const quality = input.quality === "hd" ? "hd" : "standard";
  // 与 image-service 共用同一份比例白名单（含 auto：不传宽高，走模型默认）
  const ratio = isImageAspectRatio(input.aspectRatio)
    ? input.aspectRatio
    : "1:1";
  const initImage = parseInitImage(input.init_image);

  if (!/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) {
    return json({ error: "生图请求标识无效。" }, 400);
  }
  if (prompt.length < 6) {
    return json({ error: "主体描述至少 6 个字。" }, 400);
  }
  if (initImage === null) {
    return json(
      { error: "参考图格式无效（仅支持 8MB 以内的 PNG/JPG/WebP）。" },
      400,
    );
  }

  // 用户自选模型：校验其存在且对生图开放
  const model = safeText(input.model, 80);
  let chosenAdapter = "";
  if (model) {
    const providers = await listImageProviders(env.DB);
    const chosen = providers.find(
      (p) =>
        p.id === model &&
        p.enabled &&
        p.features.split(",").map((s) => s.trim()).includes("image_studio"),
    );
    if (!chosen) {
      return json(
        { error: "所选模型不存在或未开放。", code: "bad_model" },
        400,
      );
    }
    chosenAdapter = chosen.adapter;
  }

  // 参考图只发给支持 img2img 的适配器；其余模型按纯文生图处理并在结果里提示
  const initSupported = !chosenAdapter || providerSupportsInitImage(chosenAdapter);
  const effectiveInitImage = initSupported ? initImage : "";
  const initNote =
    initImage && !initSupported
      ? "参考图已忽略：当前模型不支持图生图。"
      : "";

  // 插队：预扣插队积分（生成失败自动退回），并在请求头标记 VIP 通道。
  // 插队只对 Colab 队列有意义：选了云端模型时直接忽略，避免白扣积分
  const jump =
    input.jump === true && (!chosenAdapter || chosenAdapter === "colab-sdxl");
  const settings = await getImageSettings(env.DB);
  const jumpFee = jump ? settings.queueJumpPoints : 0;
  if (jumpFee > 0) {
    try {
      await chargeQueueJump(env.DB, session.user.id, requestId, jumpFee);
    } catch (error) {
      if (error instanceof ImageServiceError) {
        return json(
          { error: error.message, balance: error.balance, code: "insufficient" },
          error.status,
        );
      }
      return json({ error: "插队扣费失败，请稍后重试。" }, 500);
    }
  }

  // 中文 → 英文提示词（Workers AI 智能改写优先，直译兜底）。
  // 原生中文模型（方舟 Seedream / 智谱 GLM）直接用原文，跳过翻译以省时省额度
  const needsEnglish =
    !chosenAdapter || providerNeedsEnglishPrompt(chosenAdapter);
  const [enPrompt, enPrompt2, enNegative] = needsEnglish
    ? await Promise.all([
        translateImagePrompt(env, prompt),
        prompt2 ? translateImagePrompt(env, prompt2) : Promise.resolve(""),
        negativePrompt ? gtxTranslate(negativePrompt) : Promise.resolve(""),
      ])
    : ["", "", ""];

  try {
    const result = await createAndRunImageJob(env, {
      userId: session.user.id,
      requestId,
      feature: "image_studio",
      providerId: model || undefined,
      prompt,
      initImage: effectiveInitImage || undefined,
      englishPrompt: enPrompt,
      prompt2: enPrompt2,
      negativePrompt: enNegative,
      quality,
      aspectRatio: ratio,
      permission: "private",
      jump,
    });
    // 未指定模型时由路由器选模型：若最终选到不支持图生图的适配器，同样给出提示
    const note = [
      initNote,
      effectiveInitImage &&
      result.adapter &&
      !providerSupportsInitImage(result.adapter)
        ? "参考图已忽略：当前模型不支持图生图。"
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    return json(
      {
        jobId: result.id,
        url: `/api/image/asset/${result.id}`,
        pointsCost: result.pointsCost,
        balance: result.balance,
        width: result.width,
        height: result.height,
        providerId: result.providerId,
        providerName: result.providerName,
        translated: enPrompt,
        note: note || undefined,
        jumpFee: jumpFee || undefined,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ImageServiceError) {
      // 生成阶段 503 基本就是 Colab 掉线：给站长发站内信 + 邮件（30 分钟去重）
      let finalBalance = error.balance;
      if (jumpFee > 0) {
        // 生图失败：基础积分由服务自动退回，插队费在这里退回
        finalBalance = await refundQueueJump(
          env.DB,
          session.user.id,
          requestId,
          jumpFee,
        );
      }
      if (error.status === 503 && waitUntil) {
        waitUntil(notifyColabDown(env));
      }
      return json(
        {
          error: error.message,
          balance: finalBalance || error.balance,
          code:
            error.status === 402
              ? "insufficient"
              : error.status === 503
                ? "unavailable"
                : undefined,
        },
        error.status,
      );
    }
    if (jumpFee > 0) {
      const refunded = await refundQueueJump(
        env.DB,
        session.user.id,
        requestId,
        jumpFee,
      );
      return json(
        { error: "生图失败，插队积分已退回。", balance: refunded || undefined },
        500,
      );
    }
    return json({ error: "生图失败，请稍后重试。" }, 500);
  }
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, POST" },
  });
};
