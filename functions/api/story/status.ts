import type { PagesFunction } from "@cloudflare/workers-types";
import { STORY_POINTS_PER_TURN } from "../../../src/lib/story-templates";

export const onRequestGet: PagesFunction<Env> = async ({ env }) =>
  new Response(
    JSON.stringify({
      siteKeyConfigured: Boolean(env.STORY_AI_API_KEY),
      pointsPerTurn: STORY_POINTS_PER_TURN,
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};
