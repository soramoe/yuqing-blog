import type { PagesFunction } from "@cloudflare/workers-types";
import {
  sanitizeStoryState,
  STORY_POINTS_PER_TURN,
} from "../../../src/lib/story-templates";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
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
      pointsPerTurn: STORY_POINTS_PER_TURN,
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
