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
make start     # starts Docker (LiveKit), the API, the agent worker and Studio in the background
make stop      # stops all of it
```

The first `make start` creates `.env` (add your key, then run it again), installs dependencies and
builds what it needs. Run `make` to see the other commands: `status`, `logs` (or `make logs s=worker`),
`restart`, `dev` (start with live logs; Ctrl-C stops everything) and `key` (checks the Gemini key).
Quality: `make check` runs typecheck, lint and tests (or each alone: `typecheck`, `lint`, `test`);
`make fmt` fixes formatting. Cleanup: `make clean` removes build output, caches and logs;
`make reset` also removes installed dependencies. Logs are written to `.run/`.

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

Before committing: `make check`.
