# 渔情

小耗子有渔情。一个可以持续二开的静态博客，基于 Astro、MDX、Tailwind CSS、Pagefind 和 Cloudflare D1。

## 本地开发

```powershell
pnpm install
pnpm dev
```

开发地址默认为 `http://localhost:4321`。

## 新增文章

在 `src/content/blog/` 中新建 `.md` 或 `.mdx` 文件，并使用以下 frontmatter：

```yaml
---
title: "文章标题"
description: "文章摘要"
pubDate: 2026-10-27
tags: ["Astro", "写作"]
draft: false
---
```

## 新增图库图片

图库与封面图片由 Cloudflare R2 的 `media.xhz6.com` 提供，不进入网站构建产物。

1. 把原始图片放入本地 `media-src/gallery/` 或 `media-src/covers/`。
2. 运行 `pnpm optimize:images`，生成 WebP 到 `media-upload/`，并更新
   `src/data/gallery.json`。
3. 将 `media-upload/gallery/` 或 `media-upload/covers/` 中新增的文件上传到
   R2 Bucket `yuqing-media` 的对应目录。

`media-src/` 和 `media-upload/` 不提交到 Git，也不参与 Cloudflare Pages 构建。

## 构建与预览

```powershell
pnpm build
pnpm preview
```

构建产物位于 `dist/`。`pnpm build` 会同时生成 Pagefind 搜索索引。

## 评论

评论区使用登录用户身份写入 Cloudflare D1。公开读取评论不需要登录，发表和删除评论需要 GitHub 登录。评论接口位于 `functions/api/comments/`，数据表迁移位于 `migrations/`。

本地开发时复制 `.env.example` 为 `.dev.vars` 并填写登录配置。正式环境的密钥应通过 Cloudflare Pages 的“变量和密钥”页面配置，不要提交到 Git。

## 部署

推荐部署到 Cloudflare Pages：

- Build command: `pnpm build`
- Build output directory: `dist`
- Node.js: 22 或更高版本

当前使用的正式站点地址是 `https://xhz6.com`。如需更换域名，请同时修改 `astro.config.mjs` 和 `src/site.config.ts` 中的地址。
