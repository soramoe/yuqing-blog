---
title: "给静态博客加上 Cloudflare 缓存：从 DYNAMIC 到 HIT"
description: "记录一次 Astro 静态博客的实际性能排查：压缩、图片加载、预取和 Cloudflare Cache Rules，以及 Free 计划下如何让 HTML 真正命中边缘缓存。"
pubDate: 2026-10-28
category: "日常"
tags: ["Cloudflare", "Astro", "缓存", "性能", "部署"]
cover: "/gallery/20261027_050242_80858373fd28_1.png"
draft: false
---

这次优化没有从“把所有东西都压缩一遍”开始，而是先看正式站的请求链。

渔情本身是 Astro 生成的静态博客，页面已经托管在 Cloudflare Pages。Brotli、HTTP/3、带哈希的 CSS 和 JavaScript 资源都由 Cloudflare 自动处理，所以继续拆分几 KB 的 CSS 并不会带来明显收益。

真正值得处理的是三件事：图片请求是否合理、首屏资源是否在抢带宽，以及 HTML 到底有没有进入边缘缓存。

## 先确认哪些事情已经做好了

第一步不是改代码，而是测量。

正式站当时已经启用了 Brotli，CSS 压缩后只有约 7.6 KB，首页 HTML 也只有约 4.7 KB。没有外部字体，Pagefind 要等打开搜索时才加载，Giscus 也设置了延迟加载。

这意味着前端并没有明显的水桶短板。继续为了几百字节拆文件，投入和收益不成比例。

反过来，首页 HTML 的响应头显示：

```text
cf-cache-status: DYNAMIC
Cache-Control: public, max-age=0, must-revalidate
```

页面虽然托管在 Cloudflare Pages，但 HTML 请求并没有像静态资源那样稳定命中边缘缓存。Cloudflare 在屏幕之外还有一层工作可以做。

## 首页图库不再等 JavaScript

原来的首页图库会先输出占位元素，再通过一段内联 JavaScript 随机选择图片、设置 `src` 和 `srcset`，最后加一个加载完成动画。

视觉上没有问题，但它带来了两个成本：

- 图片要等 JavaScript 执行后才开始请求，浏览器的资源发现被推迟。
- 首页为了显示 4 张图，需要把全部图库元数据作为 JSON 一起发送。

后来改成构建时直接选出最近 4 张图片，把压缩后的 `src`、`srcset`、尺寸和灯箱地址全部写进 HTML。图片不再依赖客户端脚本来“出现”，首页也少了一段脚本和约 5 KB 的 JSON。

第一张图仍然使用 `loading="eager"` 和 `fetchpriority="high"`，其余图片懒加载。文章封面则根据实际首屏位置决定优先级，避免所有大图同时抢带宽。

## 图片先解决尺寸，再考虑格式

图库原来点击预览时加载的是原始 PNG，单张大约 2.2 到 2.5 MB。即使页面上的缩略图已经是 WebP，点开图片仍然会下载一张很大的原图。

最终把图库导出为 480、960、1920 三档 WebP：

```text
缩略图：480w / 960w
灯箱预览：480w / 960w / 1920w
```

当时 14 张 1920px 预览图平均约 134 KB，最大约 186 KB。只改预览图这一项，就把用户点击图片后的下载量降低了一个数量级。

这件事也提示了一个顺序问题：图片优化不只是换 WebP，而是先保证浏览器请求的是正确尺寸。

## 用 Cache Rules 只缓存静态 HTML

Cloudflare 的 Cache Rules 可以决定某个请求是否符合缓存条件。这里没有直接对所有请求打开缓存，而是只匹配真正需要的页面。

规则名是「静态 HTML 边缘缓存」，匹配表达式大致如下：

```text
http.host eq "xhz6.com"
and not http.request.uri.path contains "."
and (
  http.request.uri.path eq "/"
  or starts_with(http.request.uri.path, "/blog/")
  or starts_with(http.request.uri.path, "/gallery/")
  or starts_with(http.request.uri.path, "/about/")
  or starts_with(http.request.uri.path, "/categories/")
  or starts_with(http.request.uri.path, "/tags/")
)
```

条件里排除了带扩展名的文件，因此 CSS、JavaScript、RSS 和图片不会被这条 HTML 规则误伤。以后增加 `/admin`、`/account` 或 API 路由时，也不应该加入这条规则。

缓存资格选择「符合缓存条件」，浏览器 TTL 选择「接受源服务器 TTL」。Free 计划不能直接在规则里覆盖边缘 TTL，所以真正的边缘缓存时长由源站响应头决定。

Pages 的 `_headers` 最终设置了：

```text
Cache-Control: public, max-age=0, s-maxage=3600, stale-while-revalidate=86400
```

这三个值分别表达：

- 浏览器每次都重新验证，避免页面更新后长时间停留在旧版本。
- Cloudflare 边缘缓存 1 小时。
- 超过 1 小时后，可以先返回旧内容，同时在后台重新验证。

## 第一次部署没有成功

提交后，Cloudflare Pages 第一次构建卡在克隆 GitHub 仓库，五分钟后报了一个临时的 TLS 断连错误。

这看起来像缓存配置出错，但实际上日志明确显示失败发生在 `clone repo` 阶段，构建命令还没有开始执行。

使用页面上的「重试部署」后，仓库 4 秒完成克隆，图片生成和 Astro 构建正常完成，整个过程不到一分钟。

这里得到的经验是：部署失败先读日志阶段，不要因为最终结果是红色就立刻改代码。网络、仓库克隆和构建是三个不同层面的故障。

## 怎么判断缓存真的生效

只看控制台显示「活动」还不够。部署完成后，对同一个 URL 连续请求两次，并检查响应头：

```text
第一次：cf-cache-status: MISS
第二次：cf-cache-status: HIT
Age: 15
```

第二次出现 `Age`，说明响应确实来自 Cloudflare 缓存，而不是每次重新回源。

这一步比截图里的「规则已保存」更有说服力。缓存规则、响应头和真实请求三者都能对上，才算完成。

## 这次留下了什么

在这次优化结束时，图库大图已经明显变小，首页 HTML 从约 25.5 KB 降到 21 KB，构建产物从约 38.8 MB 降到 9.37 MB，HTML 也开始稳定命中边缘缓存。

不过，9.37 MB 里的大部分仍然是图片。于是下一步变成把媒体从网站构建中彻底移走，放到 Cloudflare R2。那部分是另一篇日志的内容。

这次最大的体会是：静态博客的性能优化很少是“加一个插件”。更常见的是先找到请求链里真正昂贵的部分，再用平台提供的缓存、尺寸选择和加载策略，把不必要的成本提前消掉。
