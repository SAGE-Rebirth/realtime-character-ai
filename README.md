# MetaAvatar (working name)

Real-time conversational AI personas with a live, expressive body, powered by the Gemini Live API.
Every frame is generated live, never pre-recorded: either neural video made from a single image by
our own Neural Avatar Engine, or a full-body 3D avatar rendered on the viewer's device. Everything is
built in-house on open-source software and open-weight models; Gemini Live is the only external
service. Quality bar (benchmark only, not used): [Runway Characters](https://runway.com/product/characters).

- [Architecture](docs/ARCHITECTURE.md) — system design, decisions, latency budget, safety & compliance
- [Implementation Guide](docs/IMPLEMENTATION_GUIDE.md) — phased build plan, acceptance criteria, risks

Original brief: [project_details.jpeg](project_details.jpeg)

## Run it locally (MacBook, free tiers)

Prerequisites: Docker Desktop (or OrbStack), Node 22+, pnpm, [uv](https://docs.astral.sh/uv/), and a
Gemini API key from Google AI Studio, set as `LIVE_MODEL_API_KEY` in `.env` (falls back to `GEMINI_API_KEY`). The default live model is `gemini-3.1-flash-live-preview` on API version `v1alpha`.

```bash
cp .env.example .env            # then adjust if needed
pnpm install
pnpm --filter @metaavatar/protocol build
pnpm infra:up                   # local LiveKit server (Docker)
(cd services/agent-worker && uv sync)
```

Then, in three terminals:

```bash
pnpm dev:api        # session API on http://localhost:8787
pnpm dev:worker     # Gemini Live agent worker
pnpm dev:studio     # Studio on http://localhost:3100/playground
```

Open http://localhost:3100/playground and press **Start conversation**. **Lip-sync test** works
without Gemini: the avatar mouths whatever your microphone hears.

| Path | What it is |
|---|---|
| `packages/protocol` | Shared schemas (Zod) for agent config and data-channel events; `pnpm gen:protocol` regenerates the Python models |
| `packages/avatar-runtime` | Browser runtime: three.js scene, procedural/VRM avatar, motion + gestures, AudioWorklet lip-sync, LiveKit session |
| `services/agent-worker` | Python LiveKit agent: Gemini Live, safety preamble, gesture planner, `express` tool, avatar events |
| `services/api` | Hono API: lists agents, mints LiveKit tokens that dispatch the worker with the agent config |
| `apps/studio` | Next.js Studio; `/playground` is the test bench with live metrics |
| `infra/docker` | Local LiveKit (and optional Postgres/Redis/MinIO with `--profile full`) |

Tests: `pnpm test` (TypeScript) and `cd services/agent-worker && uv run pytest`.
