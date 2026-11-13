import { serve } from "@hono/node-server";
import { createApp, loadConfig } from "./app";

const port = Number(process.env.API_PORT ?? 8787);
// The API has no sign-in yet, so by default it only answers this machine. Set API_HOST=0.0.0.0 to
// reach it from other devices (a phone on the same Wi-Fi) or from inside a container.
const hostname = process.env.API_HOST ?? "127.0.0.1";
serve({ fetch: createApp(loadConfig()).fetch, port, hostname }, () => {
  console.log(`MetaAvatar API listening on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}`);
});
