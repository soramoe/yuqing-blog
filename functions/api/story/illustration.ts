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

const characterBrief = (value: unknown) => {
  const characters = sanitizeStoryCharacters(value);
  const protagonist = characters.protagonist;
  const protagonistText = [
    protagonist.name && `主角：${protagonist.name}`,
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
  return [protagonistText, castText ? `配角：${castText}` : ""]
    .filter(Boolean)
    .join("。");
};

const fallbackSceneBrief = (narrative: string) =>
  narrative
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);

async function createSceneBrief(
  env: Env,
  input: {
    narrative: string;
    summary: string;
    characters: unknown;
    style: string;
  },
) {
  const apiKey = env.STORY_AI_API_KEY?.trim();
  if (!apiKey) {
    return {
      zh: fallbackSceneBrief(input.narrative),
      en: "",
    };
  }
  const baseUrl =
    env.STORY_AI_BASE_URL?.trim() || "https://api.deepseek.com";
  const endpoint = baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const model = env.STORY_AI_MODEL?.trim() || "deepseek-chat";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "你是插画分镜编辑。只提取章节中真实存在的画面，不添加正文没有的地点、角色或关键道具。",
          },
          {
            role: "user",
            content: `从下面的互动小说章节中，选择最能代表本章冲突或转折的一个瞬间，改写成可直接交给生图模型的中英文画面提示词。

人物设定：${characterBrief(input.characters) || "按正文识别"}
视觉风格：${input.style}
上下文摘要：${input.summary || "无"}
本章正文：
${input.narrative.slice(0, 2600)}

要求：
1. 具体写出谁在什么地点、正在做什么、面向谁，以及画面中的关键道具。
2. 描述镜头景别、光线和氛围，但不要写“总结整章”或解释故事。
3. 控制在 120～260 个汉字，只写一个连续画面。
4. 不生成文字、字幕、水印、标志或排版。
5. 中文控制在 120～260 个汉字，英文控制在 80～180 个英文单词。
6. 严格输出：
@@SCENE_ZH@@
中文画面提示词
@@SCENE_EN@@
English image prompt
@@END@@`,
          },
        ],
        temperature: 0.5,
        max_tokens: 420,
        stream: false,
      }),
    });
    if (!response.ok) {
      return {
        zh: fallbackSceneBrief(input.narrative),
        en: "",
      };
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const zhStart = raw.indexOf("@@SCENE_ZH@@");
    const enStart = raw.indexOf("@@SCENE_EN@@", zhStart + 12);
    const end = raw.indexOf("@@END@@", enStart + 12);
    const zh =
      zhStart >= 0
        ? raw
            .slice(zhStart + 12, enStart >= 0 ? enStart : end)
            .trim()
        : fallbackSceneBrief(input.narrative);
    const en =
      enStart >= 0
        ? raw
            .slice(enStart + 13, end >= 0 ? end : undefined)
            .trim()
        : "";
    return {
      zh:
        zh.length >= 30
          ? zh.slice(0, 700)
          : fallbackSceneBrief(input.narrative),
      en: en.length >= 50 ? en.slice(0, 1200) : "",
    };
  } catch {
    return {
      zh: fallbackSceneBrief(input.narrative),
      en: "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

const buildIllustrationPrompt = (input: {
  sceneBrief: string;
  narrative: string;
  summary: string;
  templateId: string;
  style: string;
  characters: unknown;
}) => {
  const template = getStoryTemplate(input.templateId);
  return [
    "绘制一幅中文互动小说的章节插画。",
    `画面主体（最高优先级，必须严格表现）：${input.sceneBrief}`,
    characterBrief(input.characters)
      ? `人物固定设定：${characterBrief(input.characters)}。`
      : "",
    input.summary ? `上下文摘要：${input.summary.slice(0, 500)}` : "",
    `世界类型：${template?.title ?? "虚构世界"}。视觉风格：${input.style}，电影感构图，画面完整，细节丰富。`,
    `再次强调核心画面：${input.sceneBrief}`,
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

  const sceneBriefs = await createSceneBrief(env, {
    narrative,
    summary,
    style: style || "叙事插画",
    characters: input.characters,
  });
  const prompt = buildIllustrationPrompt({
    sceneBrief: sceneBriefs.zh,
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
      englishPrompt: sceneBriefs.en,
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
