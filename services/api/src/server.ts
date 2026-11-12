import { serve } from "@hono/node-server";
import { createApp, loadConfig } from "./app";

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: createApp(loadConfig()).fetch, port }, () => {
  console.log(`MetaAvatar API listening on http://localhost:${port}`);
});
