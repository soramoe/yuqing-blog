import { createAuth } from "../../../src/lib/auth";

export const onRequest: PagesFunction<Env> = ({ request, env }) => {
  const auth = createAuth(env, new URL(request.url));
  return auth.handler(request);
};
