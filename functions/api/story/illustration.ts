import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import {
  createAndRunImageJob,
  ImageServiceError,
} from "../../../src/lib/image-service";
import {
  getStoryTemplate,
  sanitizeStoryCharacters,
} from "../../../src/lib/story-templates";

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

const buildIllustrationPrompt = (input: {
  narrative: string;
  summary: string;
  templateId: string;
  style: string;
  characters: unknown;
}) => {
  const template = getStoryTemplate(input.templateId);
  const characters = sanitizeStoryCharacters(input.characters);
  const protagonist = characters.protagonist;
  const protagonistText = [
    protagonist.name,
    protagonist.gender,
    protagonist.age,
    protagonist.appearance,
    protagonist.personality.length > 0
      ? `性格${protagonist.personality.join("、")}`
      : "",
  ]
    .filter(Boolean)
    .join("，");
  const castText = characters.supportingCast
    .slice(0, 3)
    .map(
      (character) =>
        `${character.name || "关键配角"}（${character.relationship || character.role || "与主角相关"}）`,
    )
    .join("；");
  return [
    "为一章中文互动小说绘制叙事插画。",
    `世界氛围：${template?.premise ?? "虚构故事世界"}。`,
    `视觉风格：${input.style}，电影感构图，画面完整，细节丰富。`,
    `本章画面：${input.narrative.slice(0, 1600)}`,
    input.summary ? `上下文摘要：${input.summary.slice(0, 500)}` : "",
    protagonistText ? `主角固定外观：${protagonistText}。` : "",
    castText ? `出场配角：${castText}。` : "",
    "只绘制场景、人物和氛围，不生成任何文字、字幕、水印、标志或排版。",
    "避免真实公众人物、现实商标、畸形肢体、低清晰度和过度血腥。",
  ]
    .filter(Boolean)
    .join("\n");
};

export const onRequestPost: PagesFunction<Env> = async ({
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
    return json({ error: "生图参数格式无效。" }, 400);
  }
  const input =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const requestId = safeText(input.requestId, 80);
  const storySessionId = safeText(input.sessionId, 80);
  const templateId = safeText(input.templateId, 40);
  const style = safeText(input.style, 30);
  const narrative = safeText(input.narrative, 4000);
  const summary = safeText(input.summary, 1200);
  const turnIndex = Number(input.turnIndex);
  if (
    !/^[a-zA-Z0-9-]{8,80}$/.test(requestId) ||
    !/^[a-zA-Z0-9-]{8,80}$/.test(storySessionId) ||
    !Number.isInteger(turnIndex) ||
    turnIndex < 0 ||
    turnIndex > 1000 ||
    !getStoryTemplate(templateId) ||
    narrative.length < 20
  ) {
    return json({ error: "章节生图参数无效。" }, 400);
  }

  const prompt = buildIllustrationPrompt({
    narrative,
    summary,
    templateId,
    style: style || "叙事插画",
    characters: input.characters,
  });
  try {
    const result = await createAndRunImageJob(env, {
      userId: session.user.id,
      requestId,
      feature: "story_chapter",
      sourceId: `story:${storySessionId}:turn:${turnIndex}`,
      prompt,
      negativePrompt:
        "文字，字幕，水印，标志，低清晰度，肢体畸形，真实公众人物，现实商标",
      quality: input.quality === "hd" ? "hd" : "standard",
      aspectRatio: "1:1",
      permission: "private",
    });
    return json(
      {
        illustration: {
          ...result,
          url: `/api/image/asset/${result.id}`,
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof ImageServiceError) {
      return json(
        { error: error.message, balance: error.balance },
        error.status,
      );
    }
    return json({ error: "章节生图失败，请稍后重试。" }, 500);
  }
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};
