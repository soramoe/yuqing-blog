import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// 站点是全静态的，functions/ 由 Cloudflare Pages 单独编译。
// 本地用 `pnpm dev:api` 起 wrangler，这里把 /api 代理过去，
// 让 `astro dev` 下的登录和会话跟线上一致。
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8788";

export default defineConfig({
  site: "https://xhz6.com",
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  integrations: [mdx(), sitemap()],
  // 固定绑 IPv4。Astro 默认只监听 [::1]，而 Windows 上 127.0.0.1 是另一条栈，会连不上。
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        "/api": {
          target: API_ORIGIN,
          changeOrigin: false,
        },
      },
    },
  },
});
