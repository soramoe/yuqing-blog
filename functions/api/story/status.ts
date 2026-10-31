import type { PagesFunction } from "@cloudflare/workers-types";
import {
  sanitizeStoryState,
} from "../../../src/lib/story-templates";
import { getStorySettings } from "../../../src/lib/story-settings";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const settings = await getStorySettings(env.DB);
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
