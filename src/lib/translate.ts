const CJK = /[\u4e00-\u9fff]/;

export interface TranslateEnv {
  AI?: {
    run(
      model: string,
      inputs: Record<string, unknown>,
      options?: { returnRawResponse?: boolean },
    ): Promise<unknown>;
  };
  /** 生图提示词改写专用的 DeepSeek 密钥；未设置时回退 STORY_AI_API_KEY */
  IMAGE_TRANSLATE_API_KEY?: string;
  STORY_AI_API_KEY?: string;
  STORY_AI_BASE_URL?: string;
}

// 把中文自然语言改写成 SDXL 关键词式英文提示词（不是逐字直译）
const REWRITE_SYSTEM_PROMPT = [
  "你是资深的 AI 绘画提示词工程师。把用户给出的中文生图描述改写成 Stable Diffusion XL 风格的英文提示词。要求：",
  "1. 用逗号分隔的关键词短语，不要写成完整句子。",
  "2. 完整保留主体、动作、场景、构图、光影、色彩、艺术风格等要素；不要添加原文没有的内容。",
  "3. 末尾可补充两三个通用画质词（如 highly detailed, sharp focus）。",
  "4. 只输出英文提示词本身，不要解释、引号或任何前缀。",
].join("\n");

const cleanRewrite = (value: string) =>
  value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .slice(0, 1200);

// 1) Workers AI：站点已绑定 AI，无需任何额外密钥
async function rewriteWithWorkersAi(env: TranslateEnv, text: string) {
  if (!env.AI) throw new Error("AI binding missing");
  const result = (await env.AI.run(
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    {
      messages: [
        { role: "system", content: REWRITE_SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, 1000) },
      ],
      max_tokens: 300,
      temperature: 0.3,
    },
  )) as { response?: string };
  const rewritten = result?.response?.trim();
  if (!rewritten) throw new Error("empty response");
  return cleanRewrite(rewritten);
}

// 2) DeepSeek：生图专用密钥优先，其次回退互动小说的 STORY_AI_API_KEY
async function rewriteWithStoryAi(env: TranslateEnv, text: string) {
  const apiKey =
    env.IMAGE_TRANSLATE_API_KEY?.trim() || env.STORY_AI_API_KEY?.trim();
  if (!apiKey) throw new Error("no key");
  const baseUrl = env.STORY_AI_BASE_URL?.trim() || "https://api.deepseek.com";
  const endpoint = baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return chatRewrite(endpoint, apiKey, "deepseek-chat", text);
}

async function chatRewrite(
  endpoint: string,
  apiKey: string,
  model: string,
  text: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
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
          { role: "system", content: REWRITE_SYSTEM_PROMPT },
          { role: "user", content: text.slice(0, 1000) },
        ],
        temperature: 0.3,
        max_tokens: 300,
        stream: false,
      }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("empty response");
    return cleanRewrite(content);
  } finally {
    clearTimeout(timeout);
  }
}

// 4) Google 免密钥直译（最后兜底；只翻含汉字的文本，失败原样返回）
async function gtxTranslate(text: string) {
  if (!CJK.test(text)) return text;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=" +
          encodeURIComponent(text),
        { signal: controller.signal },
      );
      if (!response.ok) return text;
      const payload = (await response.json()) as unknown;
      const rows = Array.isArray(payload) ? (payload[0] as unknown[]) : [];
      const translated = rows
        .map((row) =>
          Array.isArray(row) && typeof row[0] === "string" ? row[0] : "",
        )
        .join("");
      return translated || text;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return text;
  }
}

// 对外入口：中文 → SDXL 风格英文提示词。
// 链路：生图专用 DeepSeek（如已配置）→ Workers AI → 共用 DeepSeek → Google 直译 → 原样返回
export async function translateImagePrompt(env: TranslateEnv, text: string) {
  if (!text.trim() || !CJK.test(text)) return text;
  const rewriters: Array<() => Promise<string>> = [];
  if (env.IMAGE_TRANSLATE_API_KEY?.trim()) {
    rewriters.push(() => rewriteWithStoryAi(env, text));
  }
  rewriters.push(() => rewriteWithWorkersAi(env, text));
  if (!env.IMAGE_TRANSLATE_API_KEY?.trim() && env.STORY_AI_API_KEY?.trim()) {
    rewriters.push(() => rewriteWithStoryAi(env, text));
  }
  for (const rewriter of rewriters) {
    try {
      return await rewriter();
    } catch {
      // 该渠道不可用则尝试下一个
    }
  }
  return gtxTranslate(text);
}

export { gtxTranslate };
