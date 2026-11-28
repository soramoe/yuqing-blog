/// <reference types="@cloudflare/workers-types" />

/**
 * Worker/Pages Functions 全局环境接口。
 * 这里只保留与 Cloudflare 运行时相关的字段（无 astro 类型依赖），
 * 使 functions/ 目录可以独立做类型检查（见 functions/tsconfig.json）。
 * 新增环境变量时请在此处和 src/env.d.ts 同步维护（若 astro 侧也需要）。
 */
interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  MEDIA_PRIVATE_BUCKET: R2Bucket;
  AI?: Ai;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  COMMENT_ADMIN_USER_IDS?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  STORY_AI_API_KEY?: string;
  STORY_AI_BASE_URL?: string;
  STORY_AI_MODEL?: string;
  IMAGE_QWEN_API_KEY?: string;
  IMAGE_QWEN_BASE_URL?: string;
  IMAGE_SILICONFLOW_API_KEY?: string;
  IMAGE_SILICONFLOW_BASE_URL?: string;
  /** Colab SDXL 上游：ngrok 固定域名，如 https://xxxx.ngrok-free.app */
  IMAGE_COLAB_URL?: string;
  /** 与 Colab 端 API_KEY 一致的上游密钥 */
  IMAGE_COLAB_KEY?: string;
  /** 智谱 GLM（bigmodel.cn）生图密钥；供应商行绑定 api_key 时可留空 */
  IMAGE_BIGMODEL_API_KEY?: string;
  /** 生图提示词改写专用的 DeepSeek 密钥；未设置时回退 STORY_AI_API_KEY */
  IMAGE_TRANSLATE_API_KEY?: string;
}
