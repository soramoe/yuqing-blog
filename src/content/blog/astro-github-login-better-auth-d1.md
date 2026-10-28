---
title: "给静态博客接上 GitHub 登录：Better Auth、Pages Functions 与 D1"
description: "保留 Astro 静态页面，用 Better Auth、Cloudflare Pages Functions 和 D1 做出登录、账户页与 30 天会话，并记录实际部署中的配置顺序。"
pubDate: 2026-10-28
publishedAt: 2026-10-28T17:54:54+08:00
category: "日常"
tags: ["Astro", "Cloudflare", "Better Auth", "D1", "登录"]
cover: "/gallery/20261019_093735_f11f9ff60132_1.png"
draft: false
---

博客一直由 Astro 静态生成，页面快、构建也简单。但后面的评论、签到和积分都需要知道“现在是谁在操作”，所以第一步不是继续加组件，而是补上一套真正属于站点的用户身份。

这次没有把整站改成服务端渲染，而是只让登录接口动态运行。文章、图库和页面仍由 Pages 静态托管，访问者只有在登录和读取会话时才进入 Pages Functions。

## 为什么没有把整站改成 SSR

Astro 当然可以配合 Cloudflare 做 SSR，但这个博客的大多数页面不需要每次请求都重新生成。为了一个登录按钮让全站进入服务端渲染，会增加运行成本，也会丢掉现有静态页面的缓存优势。

最终的结构是：

```text
浏览器
  ├─ 静态页面：Astro + Pages
  ├─ 登录接口：functions/api/auth/*
  └─ 账户接口：Better Auth
                    ├─ GitHub OAuth
                    └─ Cloudflare D1
```

静态页面负责登录按钮、登录页和账户页的外壳；浏览器通过 Better Auth Client 读取 Session。真正的 OAuth 跳转、回调、Cookie 和数据库操作都在 Pages Functions 中完成。

## 选择 Better Auth 和 D1

这次使用 GitHub 登录，不开放邮箱密码。这样就不需要在 Worker 里保存和校验密码，也避开了密码哈希带来的 CPU 开销和额外安全责任。

登录数据放在 Cloudflare D1。创建了名为 `yuqing-auth` 的数据库，并建立四张表：

- `user`：用户基本资料。
- `session`：登录会话和过期时间。
- `account`：第三方登录账号与用户的绑定。
- `verification`：预留的验证记录。

Better Auth 通过 Drizzle Adapter 使用这些表。Session 有效期为 30 天，并设置每天最多续期一次。登录成功后由 Better Auth 写入 HttpOnly Cookie，前端不直接接触用户密码或 OAuth 密钥。

## 登录流程是怎么走通的

GitHub OAuth App 的名称是“渔情”，主页地址为 `https://xhz6.com`，授权回调地址为：

```text
https://xhz6.com/api/auth/callback/github
```

Pages Functions 的入口只做一件事：创建 Better Auth 实例，然后把请求交给它处理。

```ts
export const onRequest: PagesFunction<Env> = ({ request, env }) => {
  const auth = createAuth(env, new URL(request.url));
  return auth.handler(request);
};
```

实际登录时，页面会依次完成：

1. 请求 `/api/auth/sign-in/social`。
2. 跳转到 GitHub，申请只读的公开资料和邮箱。
3. GitHub 带着授权码返回 `/api/auth/callback/github`。
4. Better Auth 验证 OAuth State 和 PKCE，取得用户资料。
5. 首次登录创建本地用户，同时写入第三方账号绑定和 Session。
6. 浏览器回到账户页，之后通过 `/api/auth/get-session` 判断登录状态。

站内链接会保留原本要去的地址。例如从文章评论区登录时，会带上 `next` 参数，授权成功后直接回到那篇文章，而不是统一跳到账户页。

## 三层配置缺一不可

本地构建通过并不代表生产登录可用。这次实际需要同时配置三层：

### 1. GitHub OAuth

除了 Client ID，还要生成 Client Secret。Secret 只会完整显示一次，需要在生成后立即保存到安全位置。

### 2. Cloudflare Pages 变量

正式项目里新增了三个加密变量：

```text
BETTER_AUTH_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
```

它们只能进入 Cloudflare 的加密变量配置，不能写进仓库。示例文件只保留变量名，真正的值在本地使用 `.dev.vars`。

### 3. Pages Functions 运行时

项目通过 `wrangler.jsonc` 配置 D1 绑定和 `nodejs_compat`。D1 的绑定名必须是 `DB`，否则 Worker 虽然能编译，运行时会找不到数据库。

登录相关接口必须禁止公共缓存：

```text
/api/*
  Cache-Control: no-store
```

Session 和登录跳转不能交给 CDN 缓存，否则不同用户可能收到错误状态。

## 上线后的验证顺序

部署完成后没有只看“构建成功”，而是分别检查了：

- `/login/` 返回 `200`，页面包含 GitHub 登录按钮。
- `/api/auth/get-session` 返回 `200`，并带有 `Cache-Control: no-store`。
- 登录接口返回 `200`，生成的 GitHub 授权地址使用正确 Client ID 和回调地址。
- OAuth 回调后，账户页能读取昵称、头像和邮箱。
- 刷新页面后 Session 仍然有效。
- 退出登录后，账户页会重新要求登录。
- 普通文章和静态资源继续命中现有缓存策略。

还有一个很容易误判的问题：Pages 已经部署新版本，文章页却可能仍然返回旧缓存。静态页面缓存和 Functions 版本更新不是同一个动作，验证时要把 `cf-cache-status` 一起看，必要时清理对应页面缓存。

## 这次留下的边界

当前只接入了 GitHub，没有开放邮箱密码登录。以后增加 QQ 或微信时，可以继续沿用同一个用户与 Session，只新增第三方账号绑定。

登录本身已经完成，但它只是用户系统的地基。真正能检验这套身份是否有用的，是接下来让评论、签到和积分都能在服务端确认“当前用户是谁”。评论系统就是第一个使用者。
