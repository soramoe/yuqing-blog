---
title: "给渔情加上邮箱验证码登录：GitHub、邮箱与积分绑定怎么打通"
description: "在保留 GitHub 登录的基础上接入邮箱验证码，通过 Better Auth、Cloudflare D1 与 Resend 完成登录、绑定、奖励和完整上线验证。"
pubDate: 2026-10-28
publishedAt: 2026-10-28T21:43:36+08:00
category: "日常"
tags: ["Astro", "Cloudflare", "Better Auth", "D1", "登录", "邮件"]
cover: "/gallery/uploads/20261028_65c1cdfc056c.png"
draft: false
---

渔情最初只有 GitHub 登录。对熟悉 GitHub 的人来说已经够用，但访问者不一定愿意为了评论、签到或看积分而绑定 GitHub。一个只有第三方 OAuth 的登录入口，实际上会把一部分用户挡在门外。

这次给登录页增加了第二条路径：输入任意有效邮箱，收到 6 位验证码后即可登录。GitHub 仍然保留，两种方式对应同一个用户体系。已经用 GitHub 登录的人可以再绑定邮箱，已经用邮箱登录的人也可以再绑定 GitHub，两种绑定各奖励 5 积分，而且每个奖励只能领取一次。

## 最终做出来的流程

登录页现在提供两个入口：

```text
GitHub OAuth
或
邮箱地址 → 发送验证码 → 输入 6 位数字 → 登录
```

邮箱采用验证码登录，不保存邮箱密码。验证码 10 分钟内有效，最多尝试 5 次。发送按钮会进入 60 秒倒计时，服务端还会限制每个用户在一小时内最多发起 5 次绑定验证码请求。

登录后，账户页会读取当前账号已经绑定的方式：

- GitHub 用户没有验证过邮箱时，可以点击“绑定邮箱”。
- 邮箱用户还没有 GitHub 账号记录时，可以点击“绑定 GitHub”。
- 已完成绑定的方式会显示当前状态，不再重复给出奖励入口。

这不是把两个独立账号简单拼在一起。无论是 GitHub 还是邮箱登录，最终拿到的都是同一套 Session 和同一个 `user.id`，积分、评论、签到记录也都继续挂在原账号下面。

## 为什么继续使用 Better Auth

站点原本已经用 Better Auth 管理 GitHub OAuth、Session 和 D1 映射。邮箱登录没有必要再写一套平行的会话系统，因此这次直接使用它的 `emailOTP` 插件。

核心配置可以概括成下面的结构：

```ts
emailOTP({
  otpLength: 6,
  expiresIn: 10 * 60,
  allowedAttempts: 5,
  storeOTP: "hashed",
  rateLimit: {
    window: 60,
    max: 3,
  },
  async sendVerificationOTP({ email, otp, type }) {
    // 根据登录或邮箱验证类型发送邮件
  },
})
```

验证码不以明文存进数据库。Better Auth 仍负责生成 OTP、校验过期时间和尝试次数、创建 Session。Pages Functions 只负责提供运行环境、数据库绑定和发信函数。

邮件发送统一走 Resend 的 HTTPS API，没有把 SMTP 客户端塞进 Worker。这样不需要在 Cloudflare 里维护长连接，也不会额外引入 Node 环境专用的邮件库。

## 数据表如何分工

原来的登录系统已经有四张基础表：

```text
user          用户资料
session       登录会话
account       第三方账号绑定
verification  Better Auth 的临时验证记录
```

邮箱登录可以直接使用 `user`、`session` 和 `verification`。但账户页里的“给已有 GitHub 账号补绑邮箱”还有一个额外需求：更新 `user.email` 之前，必须先确认新邮箱确实归当前用户所有，并且在确认成功时同步发放积分。

因此新增了独立表 `email_binding_challenge`：

```text
id          验证记录 ID
user_id     发起绑定的用户
email       待绑定邮箱
code_hash   验证码的 HMAC
attempts    已尝试次数
expires_at  过期时间
consumed_at 使用时间
created_at  创建时间
```

验证码的哈希会把用户 ID、邮箱和验证码一起参与计算。即使数据库里保留了记录，也不能直接把 `code_hash` 当成验证码提交。

积分账户继续复用已有的 `point_account` 和 `point_transaction`。没有为用户系统再建一套积分表，避免同一个人的积分被拆到两个地方。

## 两个验证码场景不要混在一起

看起来“邮箱登录”和“已有账号绑定邮箱”都是发一封验证码邮件，但它们的业务结果不同。

### 邮箱登录

登录接口走 Better Auth 默认的 OTP 流程：

```text
POST /api/auth/email-otp/send-verification-otp
POST /api/auth/sign-in/email-otp
```

第一次使用某个邮箱时，Better Auth 会创建用户；如果邮箱已经对应现有用户，则会直接进入那个账号，不再创建重复用户。

### GitHub 账号绑定邮箱

绑定接口要求当前已经有 Session，并且账号里存在 GitHub 登录记录：

```text
POST /api/account/bind-email/request
POST /api/account/bind-email/verify
```

第一步生成并发送绑定验证码，第二步才修改 `user.email`、写入邮箱已验证状态，并新增 5 积分流水。验证码错误时只增加尝试次数，不会提前修改用户资料。

这样拆开以后，登录验证码和敏感资料变更就是两条清晰的边界，不会出现“点一下验证码就把账号邮箱换掉”的隐式行为。

## 绑定 GitHub 时如何处理账号关联

邮箱用户第一次点击“绑定 GitHub”时，会调用 Better Auth 的 `/link-social`，由 GitHub 完成 OAuth 授权。绑定成功后，`account` 表会新增一条 `provider_id = github` 的记录。

这里有两个容易出错的配置：

```ts
account: {
  accountLinking: {
    enabled: true,
    disableImplicitLinking: true,
    allowDifferentEmails: true,
    trustedProviders: ["github"],
  },
}
```

`allowDifferentEmails` 允许 GitHub 与当前邮箱不一致，因为用户可能希望用另一个 GitHub 身份登录同一站点。`disableImplicitLinking` 则保证账号不会仅因为邮箱相同就被后台悄悄合并，必须由已登录用户主动完成绑定。

## 5 积分怎样做到只发一次

绑定奖励不是只靠前端隐藏按钮，也不是只靠“用户通常不会重复点击”的假设。

每笔绑定奖励都会写入积分流水，并生成固定引用：

```text
binding:email:用户ID
binding:github:用户ID
```

`point_transaction.reference_id` 本身有唯一索引。即使两个请求同时到达，最终也只有一笔流水能写入；失败的那个 D1 批次会回滚，不会留下“余额加了但流水没写”的中间状态。

邮箱绑定的验证码消费、邮箱更新、积分账户创建、余额增加和流水写入会放在同一个 D1 批次里。任何一步失败，整组操作都不会只成功一半。

还要区分“账号第一次就是 GitHub 登录”和“后来主动绑定 GitHub”。前者不应该在每次打开账户页时自动领取奖励，因此接口会比较 GitHub 账号记录与用户创建时间，只给后续主动绑定的账号发放奖励。

## Resend 与域名验证

邮件服务使用 Resend。Cloudflare 负责运行 Pages Functions，Resend 负责把验证码送到用户邮箱。

生产环境需要两个加密变量：

```text
RESEND_API_KEY
EMAIL_FROM=渔情 <login@xhz6.com>
```

API Key 设置为“仅发送邮件”权限，不需要账户管理或联系人权限。它只保存在 Cloudflare 的加密环境变量里，没有进入仓库，也没有写进前端代码。

要让收件服务器信任 `xhz6.com`，还在 Cloudflare DNS 中增加了以下记录：

- `resend._domainkey` 的 DKIM TXT 记录。
- `rsend` 指向 `rsend.forge.rmta.net` 的 CNAME。
- `send` 指向 `send.forge.rmta.net` 的 CNAME。
- `_dmarc` 的 TXT 记录，先使用 `p=none` 观察投递情况。

两条 CNAME 必须保持 DNS Only，不能让 Cloudflare 代理。域名状态从 Pending 变成 Verified 后，邮件才能真正稳定发出。

小站点的验证码数量不高，Resend 的免费额度足够起步；以后邮件量增加，再根据实际发送数量调整套餐。

## 数据库迁移和部署顺序

代码部署和数据库迁移不是同一个动作。如果先部署使用新表的接口，再执行迁移，用户一打开绑定页面就会遇到 “no such table”。

这次按以下顺序上线：

1. 创建 `0006_email_binding_otp.sql`。
2. 在正式 D1 中执行建表和索引。
3. 写入 `d1_migrations`，保证后续迁移状态一致。
4. 在 Cloudflare 配置 Resend 加密变量。
5. 完成 Resend 发件域名验证。
6. 推送代码并等待 Pages 部署成功。
7. 在正式域名上执行完整流程测试。

迁移后的核心索引是：

```sql
CREATE INDEX email_binding_user_created_idx
ON email_binding_challenge (user_id, created_at);

CREATE INDEX email_binding_email_idx
ON email_binding_challenge (email);
```

第一个索引用于执行发送频率和用户维度查询，第二个索引用于检查邮箱是否已经被使用。

## 上线验证不是只看按钮

页面能显示输入框，只能说明前端构建成功。真正上线时，至少需要验证以下几层。

### 邮件投递

先向 Resend 的测试地址发送验证码，控制台状态显示为 `Delivered`。随后使用站长自己的邮箱再次测试，邮件也能正常送达。

### 登录与会话

输入邮箱收到的 6 位验证码后，页面会回到账户页并读取同一个用户。刷新页面后 Session 仍然存在，不需要重新验证。

错误验证码会被拒绝，并显示中文提示：“验证码不正确或已过期”。发送按钮有倒计时，服务端也不会接受超频请求。

### 绑定奖励

GitHub 账号完成邮箱验证后，积分流水新增一笔：

```text
绑定邮箱奖励 +5
```

账户余额同步增加 5，绑定入口随即消失。再次刷新页面不会重复发放。

### 原有 GitHub 登录

退出后重新使用 GitHub 登录，仍然进入原来的用户、原有积分和原有评论身份。邮箱绑定只增加了登录方式，没有产生第二个账号。

### 未登录权限

直接请求账户绑定接口和 GitHub 奖励接口时都会返回 `401`。即使知道接口地址，也不能在未登录状态下读取或修改其他用户信息。

### 页面缓存

Cloudflare Pages 部署完成后，正式域名仍可能在短时间内返回上一版静态 HTML。检查时不能只看构建状态，还要确认 `xhz6.com` 返回的 HTML 是否已经包含新页面，必要时清理 Cloudflare 缓存。

## 现在可以怎样登录

目前账户系统支持两条入口：

```text
GitHub → 直接进入已有账号
邮箱 → 验证码登录或自动创建账号
```

两种方式都进入同一个账户中心。后续接 QQ、微信、Passkey 等入口时，也只需要继续扩展登录方式，不需要再重做 Session、积分或评论数据。

这次实现的重点不是“多一个输入框”，而是把身份、验证、账号绑定和积分奖励拆成可以验证的边界。只有每一层都能单独通过测试，邮箱登录才真正算做完。
