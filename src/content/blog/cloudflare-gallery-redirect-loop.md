---
title: "当 /gallery/* 指向 /gallery/：一次重定向循环排查"
description: "图库首页突然提示重定向过多，最终发现问题来自一条把自己的首页也匹配进去的 Pages 通配符规则。"
pubDate: 2026-10-28
publishedAt: 2026-10-28T19:27:08+08:00
category: "日常"
tags: ["Cloudflare", "Pages", "重定向", "部署", "排错"]
cover: "/gallery/20261017_095130_0fe5ca7798a2_1.png"
draft: false
---

访问图库时，浏览器没有打开照片瀑布流，而是提示“重定向次数过多”。登录、文章和评论接口看起来都正常，所以问题很快缩小到了图库专用的重定向规则。

这次不是服务器故障，也不是 DNS 配错，而是一条看起来非常简单的 Pages `_redirects` 规则。

## 先看服务器实际返回了什么

浏览器遇到循环时不会给出完整的跳转链，因此没有直接刷新页面，而是先请求一次图库首页并禁止自动跟随：

```bash
curl -D - -o NUL --max-redirs 0 https://xhz6.com/gallery/
```

响应很直接：

```text
HTTP/1.1 302 Found
Location: /gallery/
```

请求的地址是 `/gallery/`，服务器返回的目标还是 `/gallery/`。这不是“跳去了错误页面”，而是页面被要求跳到自己。

如果跟随重定向，就会得到：

```text
/gallery/
→ /gallery/
→ /gallery/
→ ERR_TOO_MANY_REDIRECTS
```

到这里就可以确定，问题出在重定向规则本身。

## 旧规则为什么匹配到了首页

项目原本有三条用于回收旧媒体路径的规则：

```text
/gallery/* /gallery/ 302
/covers/* /gallery/ 302
/media/optimized/* /gallery/ 302
```

它们的目标是让旧的本地图片地址跳到新图库。但 `/gallery/*` 中的星号可以匹配空内容，所以 `/gallery/` 首页也符合规则。

最终形成了自我跳转：

```text
来源：/gallery/
目标：/gallery/
结果：无限循环
```

这种问题容易漏掉，因为规则的目的没有错，单张旧图片也确实能正确跳转；只有不带文件名的目录地址才会触发循环。

## 把通配符改成文件名参数

修复方式不是给 `/gallery/` 单独加一个例外，而是收紧来源匹配范围，让它只处理“图库目录下的一个文件名”：

```text
/gallery/:file /gallery/ 302
/covers/:file /gallery/ 302
/media/optimized/:section/:file /gallery/ 302
```

`:file` 必须匹配一个路径段，因此：

- `/gallery/old-photo.png` 会继续跳到图库首页。
- `/gallery/` 没有文件名，不再命中这条规则。
- `/covers/old-cover.jpg` 仍然可以回收。
- `/media/optimized/gallery/old-photo.webp` 仍然可以回收。

本地预览时分别验证了三条路径：

```text
/gallery/                  → 200
/gallery/old-image.png     → 302 /gallery/
/gallery                    → 308 /gallery/
```

`/gallery` 是缺少末尾斜杠时的一次规范跳转，到达 `/gallery/` 后返回 `200`，不会继续循环。

## 部署后还要处理缓存

新版本发布后，问题不一定马上消失。旧响应本身就带有 CDN 缓存：

```text
Cache-Control: public, max-age=0, s-maxage=3600
```

即使 Pages 已经上传了新规则，边缘节点仍可能在缓存有效期内继续返回旧的 302。因此需要清理站点缓存，再重新检查真实响应。

清理后最终结果：

```text
/gallery/                 200
/gallery/old-image.png    302 → /gallery/
不带斜杠的 /gallery        308 → /gallery/ → 200
```

这次确认的不是“部署成功”，而是用户真正打开图库时不会再看到循环。

## 这次踩坑留下的检查项

以后写重定向规则时，至少要检查四件事：

1. 来源是否可能匹配重定向目标本身。
2. 目录首页和目录中的文件是否被正确区分。
3. 旧路径跳转后，目标页面是否返回正常状态。
4. 新规则上线后是否还有旧缓存继续覆盖结果。

重定向规则通常只有一行，但一行里的星号可能覆盖的内容比想象中更多。能用具体路径参数时，就不应该让通配符匹配整个目录。

这次修复最终也让旧文章里的错误示例同步更新，避免以后照着旧规则再次写出同一个循环。
