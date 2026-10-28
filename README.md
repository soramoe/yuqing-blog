# 渔情

小耗子有渔情。一个可以持续二开的静态博客，基于 Astro、MDX、Tailwind CSS、Pagefind 和 Giscus。

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

把原始图片放入 `assets/gallery/`，不要直接放入 `public/`。开发或构建前会自动生成
480、960 和 1920 像素的 WebP 版本到 `public/media/optimized/gallery/`，其中
1920 版本用于灯箱预览。优化产物已加入 `.gitignore`，不需要手动提交。

## 构建与预览

```powershell
pnpm build
pnpm preview
```

构建产物位于 `dist/`。`pnpm build` 会同时生成 Pagefind 搜索索引。

## 评论

复制 `.env.example` 为 `.env`，按照 [Giscus](https://giscus.app/zh-CN) 生成的参数填写，然后重新构建。

## 部署

推荐部署到 Cloudflare Pages：

- Build command: `pnpm build`
- Build output directory: `dist`
- Node.js: 22 或更高版本

当前使用的正式站点地址是 `https://xhz6.com`。如需更换域名，请同时修改 `astro.config.mjs` 和 `src/site.config.ts` 中的地址。
