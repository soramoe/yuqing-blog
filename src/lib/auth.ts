import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { sendOtpEmail } from "./email";
import * as schema from "./auth-schema";

export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
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
    plugins: [
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
          await sendOtpEmail(env, {
            email,
            otp,
            purpose: type === "email-verification" ? "bind-email" : "login",
          });
        },
      }),
    ],
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: true,
        trustedProviders: ["github"],
      },
    },
    trustedOrigins: [
      "https://xhz6.com",
      "https://www.xhz6.com",
      "http://localhost:4321",
      "http://127.0.0.1:4321",
    ],
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
