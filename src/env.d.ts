/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

// 全局 Env 接口已移至 src/types/worker-env.d.ts
// （保持 Cloudflare 运行时类型与 astro 类型分离，见 functions/tsconfig.json）

interface ImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
