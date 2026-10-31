import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import {
  sanitizeStoryState,
} from "../../../src/lib/story-templates";
import { getStorySettings } from "../../../src/lib/story-settings";
import { getStoryTrialStatus } from "../../../src/lib/story-trial";

export const onRequestGet: PagesFunction<Env> = async ({
  request,
  env,
}) => {
  const settings = await getStorySettings(env.DB);
  const sessionCookie = request.headers.get("cookie") ?? "";
  const session =
    /(?:better-auth|session_token)/i.test(sessionCookie)
      ? await createAuth(env, new URL(request.url)).api.getSession({
          headers: request.headers,
        })
      : null;
  const trial = session?.user
    ? await getStoryTrialStatus(env.DB, session.user.id, settings)
    : null;
  let stateEngineReady = false;
  try {
    const state = sanitizeStoryState("apocalypse", { food: 3 });
    stateEngineReady = state.food === 3;
  } catch {
    stateEngineReady = false;
  }
  return new Response(
    JSON.stringify({
      siteKeyConfigured: Boolean(env.STORY_AI_API_KEY),
      siteKeyEnabled: settings.siteKeyEnabled,
      pointsPerTurn: settings.pointsPerTurn,
      maxOutputTokens: settings.maxOutputTokens,
      contextTurns: settings.contextTurns,
      dailyTurnLimit: settings.dailyTurnLimit,
      trialEnabled: settings.trialEnabled,
      trialGithubTurns: settings.trialGithubTurns,
      trialEmailTurns: settings.trialEmailTurns,
      trialMaxOutputTokens: settings.trialMaxOutputTokens,
      trialDailyBudgetYuan: settings.trialDailyBudgetYuan,
      trialIpDailyLimit: settings.trialIpDailyLimit,
      trial,
      stateEngineReady,
      turnTransport: "json-v1",
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};
