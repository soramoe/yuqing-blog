/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

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
}

interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
