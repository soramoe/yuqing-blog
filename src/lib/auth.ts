import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./auth-schema";

export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

const PRODUCTION_ORIGINS = [
  "https://xhz6.com",
  "https://www.xhz6.com",
];

// Cloudflare Pages 预览域名：<hash>.<project>.pages.dev 与 <branch>.<project>.pages.dev
const PREVIEW_ORIGINS = [
  "https://yuqing-blog.pages.dev",
  "https://*.yuqing-blog.pages.dev",
];

const LOCAL_ORIGINS = ["http://localhost:4321", "http://127.0.0.1:4321"];

function buildTrustedOrigins(env: AuthEnv, requestUrl: URL): string[] {
  const origins = new Set([
    ...PRODUCTION_ORIGINS,
    ...PREVIEW_ORIGINS,
    ...LOCAL_ORIGINS,
  ]);

  if (env.BETTER_AUTH_URL) {
    try {
      origins.add(new URL(env.BETTER_AUTH_URL).origin);
    } catch {
      // BETTER_AUTH_URL 不是合法 URL 时忽略，回落 requestUrl.origin
    }
  }

  // wrangler pages dev 的本地端口不固定，运行时来源总应被信任
  if (
    requestUrl.hostname === "localhost" ||
    requestUrl.hostname === "127.0.0.1"
  ) {
    origins.add(requestUrl.origin);
  }

  return [...origins];
}

export function createAuth(env: AuthEnv, requestUrl: URL) {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding DB is not configured.");
  }
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is not configured.");
  }

  const baseURL = env.BETTER_AUTH_URL || requestUrl.origin;
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
        }
      : null;

  return betterAuth({
    appName: "渔情",
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(
      drizzle(env.DB, {
        schema,
      }),
      {
        provider: "sqlite",
        schema,
      },
    ),
    socialProviders: github ? { github } : undefined,
    trustedOrigins: buildTrustedOrigins(env, requestUrl),
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      database: {
        joins: true,
      },
    },
  });
}
