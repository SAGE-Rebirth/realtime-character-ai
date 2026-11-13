# MetaAvatar (working name)

Real-time conversational AI personas with a live, expressive body, powered by the Gemini Live API.
Every frame is generated live, never pre-recorded: either neural video made from a single image by
our own Neural Avatar Engine, or a full-body 3D avatar rendered on the viewer's device. Everything is
built in-house on open-source software and open-weight models; Gemini Live is the only external
service. Quality bar (benchmark only, not used): [Runway Characters](https://runway.com/product/characters).

- [Architecture](docs/ARCHITECTURE.md) — system design, decisions, latency budget, safety & compliance
- [Implementation Guide](docs/IMPLEMENTATION_GUIDE.md) — phased build plan, acceptance criteria, risks
- [Roadmap](docs/ROADMAP.md) — what's done, leftover jobs, and the task list for every phase
- [Platform guide](docs/PLATFORM_GUIDE.md) — how to use Studio, step by step, for new users
- [Avatar models](assets/avatars/README.md) — where to get models, licences, how to add one

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
`restart` (or `make restart s=worker` after changing worker code; the API and Studio reload on their own), `dev` (start with live logs; Ctrl-C stops everything), `key` (checks the Gemini key) and
`eval` (measures reply time and interruptions against the running agent) and `voices` (generates
the voice samples Studio plays).
Quality: `make check` runs typecheck, lint and tests (or each alone: `typecheck`, `lint`, `test`);
`make fmt` fixes formatting. Cleanup: `make clean` removes build output, caches and logs;
`make reset` also removes installed dependencies. Logs are written to `.run/`.

### Or run everything in Docker

```bash
make stop      # if the local stack is running: both use ports 3100 and 8787
make docker    # builds and starts LiveKit, the API, the agent worker and Studio in containers
make docker-stop
```

`make docker-status` shows the containers and `make docker-logs` (or `make docker-logs s=worker`)
follows their output. The containers read the same `.env` and the same `data/` and
`assets/avatars/` folders as the local stack, so agents, documents and models are shared. Ports
are published on this machine only. The images run as a non-root user and the Gemini key is passed
at start, never built in. Use `make start` while changing code (it reloads on edits) and
`make docker` to run it as it would be deployed.

**Where is the database?** There isn't one in use yet. Agents, documents and memory are files
under `data/`; avatar models are files under `assets/avatars/`. Postgres (with pgvector), Redis
and MinIO are defined in `infra/docker/compose.yaml` under the `full` profile, ready for the move
to a database, which is the next item on the roadmap. Nothing reads or writes them today.

Open http://localhost:3100 for Studio:

- **Agents**: create an agent from a template, then work through its settings (profile, personality,
  voice, appearance, knowledge, memory, safety, versions). The stage on the right talks to your draft; press
  **Publish** when it sounds right.
- **Avatars** and **Voices**: libraries of avatar models (add your own `.vrm`) and voice samples.
- **Knowledge**: add documents (PDF, Word, text, web pages), try questions against them, then tick
  the documents an agent should answer from under its Knowledge settings. The agent names the
  document it used, and the stage shows it under the captions.
- **Playground**: talk to any agent with live performance readouts; **Lip-sync test** works without
  Gemini (the avatar mouths whatever your microphone hears).
- Sections marked with a phase (Tools, Embed, Conversations, Usage) show what's planned.

Agents and knowledge documents are stored in `data/`; avatar models are `.vrm` files in
`assets/avatars/` (both git-ignored). Delete `data/agents.json` to get
the demo agents back.

| Path | What it is |
|---|---|
| `packages/protocol` | Shared schemas (Zod) for agent config and data-channel events; `pnpm gen:protocol` regenerates the Python models |
| `packages/avatar-runtime` | Browser runtime: three.js scene, procedural/VRM avatar, motion + gestures, AudioWorklet lip-sync, LiveKit session |
| `services/agent-worker` | Python LiveKit agent: Gemini Live, safety preamble, gesture planner, `express`, `search_knowledge_base`, `remember` and `recall` tools, avatar events |
| `services/api` | Hono API: agents and versions, avatar files, the knowledge base (ingest, embeddings, search), and LiveKit tokens that dispatch the worker with the agent config |
| `apps/studio` | Next.js Studio: agent editor with live stage, avatar and voice libraries, playground |
| `evals` | `latency.py`: Phase 1 acceptance eval (voice-to-voice, typed reply, barge-in) |
| `infra/docker` | `compose.yaml` (LiveKit; API, worker and Studio with `--profile app`; Postgres/Redis/MinIO with `--profile full`, not used yet) and the three Dockerfiles |

Before committing: `make check` (`make hooks` runs lint and typecheck on every commit; CI runs
`make check` on GitHub).
