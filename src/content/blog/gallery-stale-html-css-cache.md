---
title: "图库突然“裸奔”：一次旧 HTML 缓存引用失效 CSS 的排查"
description: "页面代码正常、部署也成功，线上图库却只剩浏览器默认样式。记录一次通过计算样式、404 样式表和响应头定位 Cloudflare 旧 HTML 缓存的完整排查。"
pubDate: 2026-10-31
publishedAt: 2026-10-31T03:52:00+08:00
category: "日常"
tags: ["Cloudflare", "Astro", "缓存", "CSS", "排错", "部署"]
cover: "/gallery/uploads/20261031_827338207c2f.png"
draft: false
---

打开线上图库时，看到的第一眼不是排版错位，而是整页像被浏览器剥掉了 CSS。

导航变成一串普通链接，图片按原始尺寸铺满页面，瀑布流消失，鼠标样式也回到浏览器默认状态。更让人容易误判的是，文章页、账户页和其他后台页面都能正常打开，只有图库看起来“坏了”。

这次问题最后查明，代码和构建都没有错。真正出问题的是 Cloudflare 边缘缓存里的一份旧版 HTML，它还在引用已经被新部署替换掉的旧 CSS。

## 先确认不是布局代码的问题

图库刚做过私密图片交互调整，所以第一反应很容易怀疑瀑布流或按钮样式写坏了。

但打开开发者工具后，页面没有明显的 JavaScript 报错，图片也都能加载。继续查看卡片实际计算样式，出现了几个不该出现的值：

```text
display: inline
break-inside: auto
```

源码中的图库卡片应该使用自定义样式，至少是：

```css
.waterfall-item {
  display: block;
  break-inside: avoid;
}
```

当计算样式完全退回浏览器默认值，通常已经不需要继续调试某个单独组件。更大的可能是整份样式表没有加载。

## 找到失效的旧样式表

检查页面 `<head>` 后，可以看到当前 HTML 引用了：

```text
/_astro/BaseLayout.D5ggLiMe.css
```

直接请求这个地址，返回的不是 CSS，而是网站自己的 404 页面。

与此同时，最新构建目录里实际生成的文件名已经变成：

```text
/_astro/BaseLayout.BunrveLw.css
```

这就解释了两个现象：

- 新 CSS 文件确实已经部署。
- 浏览器收到的 HTML 仍然指向旧 CSS 文件名。

Astro 会为构建资源生成内容哈希。文件内容变化后，文件名也会变化，这是正常的缓存失效设计。问题不在哈希文件名，而在于 HTML 和静态资源来自不同部署版本。

## 新部署是好的，自定义域名是旧的

为了区分“构建失败”和“缓存发错内容”，接下来直接打开本次 Cloudflare Pages 部署的临时域名。

在部署域名下：

- 图库样式正常。
- HTML 引用了新的 `BaseLayout.BunrveLw.css`。
- 样式请求返回 `200`。
- 在线图片和私密图片交互也都正常。

同一个构建在部署域名下没问题，在正式域名下却引用旧样式，范围就缩小到正式域名前面的缓存层。

正式域名的响应头当时是：

```text
cache-control: public, max-age=0, s-maxage=3600, stale-while-revalidate=86400
cf-cache-status: HIT
```

`HIT` 说明响应直接来自 Cloudflare 边缘缓存，没有回源读取最新部署。

## 根因是 HTML 和资源版本错位

静态站的 HTML 和 CSS 通常这样配合：

```text
HTML，引用带哈希的 CSS 文件名
  ↓
CSS 内容改变后，文件名随之改变
  ↓
新部署只保留新文件名
```

如果 HTML 被边缘缓存一小时，那么新一轮部署完成后，边缘节点可能继续把旧 HTML 返回给访问者。

旧 HTML 引用的旧 CSS 已经没有源文件，于是出现：

```text
旧 HTML：请求 BaseLayout.D5ggLiMe.css
新部署：只有 BaseLayout.BunrveLw.css
结果：CSS 404，整页失去样式
```

浏览器每次重新验证 HTML 本身是对的，`max-age=0` 也保证了这一点。真正让旧 HTML 停留太久的是边缘缓存：

```text
s-maxage=3600
stale-while-revalidate=86400
```

前一个值允许 Cloudflare 缓存一小时，后一个值又允许旧内容在后台重新验证时继续返回。对于带哈希文件名的静态资源，这样的组合在页面更新后风险很高。

## 先清除错误的缓存

确认原因后，第一步是清掉正式域名上残留的图库 HTML。

这次按精确 URL 清理了：

```text
https://xhz6.com/gallery/
https://xhz6.com/gallery
https://www.xhz6.com/gallery/
```

清理后重新请求图库，响应头变成新的短缓存策略：

```text
cache-control: public, max-age=0, s-maxage=60
cf-cache-status: MISS
```

再次加载页面后，样式表恢复为新文件，图库卡片重新使用 `display: block`，瀑布流、在线投稿、私密图片按钮也都回来了。

这里还有一个容易漏掉的细节：如果一边发布新版本、一边清理旧缓存，最好在部署完成后再次确认正式域名返回的 HTML、CSS 文件名和响应头是否一致。只看到“部署成功”并不等于所有边缘节点已经切换。

## 永久修复：把 HTML 缓存缩短

直接完全关闭 HTML 缓存当然能解决问题，但会让静态页面失去一部分加速效果。

最后采用折中方案，把 HTML 的页面级缓存改为短时间：

```text
Cache-Control: public, max-age=0, s-maxage=60
```

含义是：

- 浏览器仍然每次向边缘节点重新验证。
- Cloudflare 可以缓存页面 60 秒。
- 不再使用长达一天的 `stale-while-revalidate`。

静态 CSS、JavaScript 等带内容哈希的资源继续长期缓存：

```text
Cache-Control: public, max-age=31536000, immutable
```

两者配合后，页面 HTML 最多只会在短时间内保留旧版本，而真正的静态资源仍然可以利用长期缓存。

## 验证不能只看截图

页面恢复后，还需要同时检查三个层面：

1. HTML 是否引用当前构建的 CSS 文件名。
2. CSS 请求是否返回 `200` 和 `text/css`。
3. 图库卡片的计算样式是否恢复为预期的 `display: block`。

此外还验证了实际功能：

- 在线投稿图片正常显示。
- 私密图片仍是不可跳转的锁定卡片。
- 点击私密图片只显示站内提示。
- 正式域名返回的新缓存头是 `s-maxage=60`。

只有页面看起来正常还不够，资源状态、计算样式和缓存响应头都能对上，才能确认问题真正解决。

## 这次留下的经验

静态站不是上传几个 HTML 文件就结束了。HTML、CSS、JavaScript 和 CDN 缓存共同决定用户最后看到什么。

带哈希的静态资源适合长期缓存，但引用这些资源的 HTML 不应该长时间停留在边缘节点。否则新部署删除旧文件名后，缓存中的旧 HTML 就会请求一组已经不存在的资源。

还有一个很实用的判断顺序：

1. 页面是否只有整体样式或脚本失效，而不是某个组件单独异常。
2. 计算样式是否退回了浏览器默认值。
3. HTML 引用的资源 URL 是否仍存在。
4. 同一个部署在 Pages 临时域名下是否正常。
5. 正式域名的 `cf-cache-status` 和 `Cache-Control` 是否说明请求命中了旧缓存。

顺着这条链路排查，通常比反复修改 CSS、重建页面更快找到真正的问题。
