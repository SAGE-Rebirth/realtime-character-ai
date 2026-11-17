# MetaAvatar (working name)

Real-time talking characters. A person speaks, an AI answers with a voice, and a 3D avatar in the
browser lip-syncs, gestures and shows expressions while it talks. Studio is the web app where you
create these characters ("agents"), test them, and put them on a website.

## Description

MetaAvatar is a platform for conversational AI personas with a live, expressive body, powered by
the Gemini Live API. Every frame is generated live on the viewer's device, never pre-recorded.

What an agent can do today:

- **Look like anyone you have a picture of**: the Avatar Forge turns one photo or drawing of a face
  into a talking portrait in about a minute, with consent records and a picture check first.
- **Talk and listen** in real time, with interruption ("barge-in") handled in about half a second.
- **Perform**: lip-sync, gestures and expressions chosen from what it is saying, on a VRM avatar or
  the built-in character.
- **Answer from your documents** (PDF, Word, text, web pages) and name the document it used.
- **Remember** returning visitors between conversations, when you switch that on.
- **Act**: show cards on screen, call your own web addresses ("tools"), use MCP connectors, ask for
  a person, and end the conversation. Tools that change something ask the visitor first.
- **See**: the visitor's camera or shared screen, when you allow it.
- **Live on your website** through a two-line widget, limited to the sites you list.

It runs on one laptop with free tiers. Gemini Live is the only outside service; everything else is
open source and runs locally. The quality bar we measure against (benchmark only, not used) is
[Runway Characters](https://runway.com/product/characters). Original brief:
[project_details.jpeg](project_details.jpeg).

## Table of contents

- [Getting started](#getting-started)
- [Prerequisites](#prerequisites)
- [Software used](#software-used)
- [Architecture](#architecture)
- [Implementation](#implementation)
- [API](#api)
- [Finding your way around the platform](#finding-your-way-around-the-platform)
- [Guides](#guides)
- [Contributing](#contributing)

## Getting started

```bash
make start
```

The first run creates `.env` and stops. Open `.env`, put your Gemini key in `LIVE_MODEL_API_KEY`,
and run `make start` again. It installs what it needs and starts everything in the background.

Then open http://localhost:3100. The first person to open it creates the owner account; after
that, the owner adds other people under Settings.

```bash
make stop        # stops everything; your data is kept
make status      # what is running, and whether setup looks right
make logs        # follow the logs (one service: make logs s=worker)
```

To run the whole stack in containers instead, as it would be deployed:

```bash
make stop
make docker
```

`make docker-stop`, `make docker-status` and `make docker-logs` manage the containers. Both ways of
running use the same database and the same avatar folder, so your agents are there either way. Use
`make start` while changing code (it reloads on edits). Run `make` to list every command.

| Command | What it does |
|---|---|
| `make start` / `make stop` | Start or stop everything |
| `make restart s=worker` | Restart one service (`api`, `worker`, `studio`). The worker does not reload on its own |
| `make docker` / `make docker-stop` | The whole stack in containers |
| `make check` | Typecheck, lint and every test. Run before committing |
| `make protocol` | After changing `packages/protocol`: rebuild it and regenerate the Python models |
| `make key` | Test the Gemini key with one tiny request |
| `make eval` | Measure reply time and interruptions against a running agent (uses Gemini quota) |
| `make voices` | Generate the voice samples Studio plays |
| `make db` | Open a SQL prompt on the database |
| `make clean` / `make reset` | Remove build output; `reset` also removes installed dependencies. Neither touches your data |

## Prerequisites

- macOS or Linux with [Docker Desktop](https://www.docker.com/products/docker-desktop/) or OrbStack running
- [Node.js](https://nodejs.org) 22 or newer, and [pnpm](https://pnpm.io)
- [uv](https://docs.astral.sh/uv/) (it installs the right Python for the worker)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). The free tier is
  enough for demos; when its quota runs out, conversations end with an out-of-quota message
- Chrome or Safari, with a microphone

## Software used

| Part | Software |
|---|---|
| AI model | Gemini Live (`gemini-3.1-flash-live-preview`, API version `v1alpha`); Gemini embeddings for document search |
| Real-time audio and video | [LiveKit](https://livekit.io) server (in Docker) and LiveKit Agents |
| Agent worker | Python 3.12, LiveKit Agents with the Google plugin, MCP client, aiohttp, Pydantic |
| API | Node.js, [Hono](https://hono.dev), run with tsx; `pg` for Postgres |
| Database | Postgres 16 (in Docker) |
| Studio | Next.js 16, React 19, CSS modules (no UI library) |
| Avatar | three.js, `@pixiv/three-vrm`, an AudioWorklet for lip-sync |
| Shared schemas | Zod 4, with Python models generated from it |
| Tests and checks | Vitest, pytest, ruff, TypeScript strict mode, GitHub Actions |

## Architecture

```
 Browser                                   This machine (or your server)
┌─────────────────────────┐  sign-in cookie  ┌──────────────────────────┐      ┌──────────┐
│ Studio (Next.js)        │ ───────────────► │ API (Hono)               │ ───► │ Postgres │
│  agent editor, stage    │   REST, JSON     │  accounts, agents,       │      └──────────┘
│                         │                  │  documents, memory,      │
│ Avatar runtime          │                  │  tools, webhooks         │ ───► your tools and
│  three.js + VRM         │                  └───────────▲──────────────┘      webhook address
│  lip-sync, gestures     │                              │ service token        (signed)
└───────────┬─────────────┘                              │
            │ voice, captions, events (WebRTC)  ┌────────┴─────────────┐
            └──────────────► LiveKit ◄──────────│ Agent worker (Python)│ ───► Gemini Live
                                                │  one job per talk    │ ───► MCP connectors
                                                └──────────────────────┘
```

How a conversation starts:

1. Studio (or the widget on your site) asks the API to start a conversation with an agent.
2. The API checks who is asking, saves the conversation's settings, and returns a LiveKit address
   and a short-lived token. The token only names the conversation; it holds no settings.
3. The browser joins the LiveKit room. LiveKit starts a job on the worker.
4. The worker collects the conversation's settings from the API with its own token, opens a Gemini
   Live session, and starts talking.
5. Voice travels over WebRTC. Small events (state, captions, cards, permission questions) travel
   on the room's data channel. The avatar runtime turns them into motion.

The full design, the reasons behind each decision, and the latency budget are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Implementation

| Path | What it is |
|---|---|
| `apps/studio` | Studio. Pages under `app/(studio)`; the sign-in page at `app/signin`; the public embed page at `app/e/[key]`; the widget script at `public/widget.js` |
| `services/api` | The API. Routes in `src/app.ts`; one store per kind of data: `store.ts` (agents), `accounts.ts`, `memory.ts`, `knowledge/`, `integrations.ts` (tools, connectors, webhooks, activity), `forge.ts` (Avatar Forge jobs and the picture check); `db.ts` and `boot.ts` connect them to Postgres |
| `services/agent-worker` | The worker. `main.py` (the conversation), `safety.py` (instructions), `tools.py` (your tools, permission questions), `platform_api.py` (talking to the API), `knowledge.py`, `memory.py`, `events.py` |
| `packages/protocol` | Every schema shared between the parts, written once in Zod. `make protocol` regenerates the worker's Python models |
| `packages/avatar-runtime` | What runs in the browser: scene, avatars (VRM, the built-in character, portraits in `avatar/portrait.ts`), lip-sync, gesture cues, the LiveKit connection |
| `packages/sdk` | For your own apps: a browser client, a React component, and server helpers (visitor tokens, checking signatures) |
| `infra/docker` | `compose.yaml` and one Dockerfile each for the API, the worker and Studio |
| `evals` | `latency.py`: measures reply time and interruptions against a live agent |
| `assets/avatars` | Avatar models (`.vrm`) and their notes |
| `docs` | Architecture, implementation guide, roadmap, platform guide |

**Where the data is.** Accounts, agents, documents, memory, tools, the activity log and Forge consent records are in
Postgres (its files are under `infra/docker/data/postgres`). Each store keeps a copy in memory and
writes every change through to one table. Avatar models are files in `assets/avatars/`. Set
`DATABASE_URL=off` in `.env` to keep everything in files under `data/` instead.

**How it is protected.**

- People sign in with an email and password. The session is an HttpOnly cookie; passwords are
  hashed with scrypt. Changes made with the cookie are only accepted from Studio's own pages.
- Servers use an API key: `Authorization: Bearer mak_...` (create one in Studio under Settings).
- The worker uses a service token as a bearer token. The API and the worker both derive it from
  `LIVEKIT_API_SECRET`, so there is nothing to configure; set `SERVICE_TOKEN` to choose your own.
- Website visitors use a publishable embed key (`pk_...`) that opens one agent's published
  version, from the sites listed on it.
- Avatar files need a sign-in, or a link the API signed for an embed visitor (valid six hours).
- Calls to your tools and your webhook are signed with your signing secret.

Build order, acceptance criteria and lessons learned are in
[docs/IMPLEMENTATION_GUIDE.md](docs/IMPLEMENTATION_GUIDE.md). What is done and what is next is in
[docs/ROADMAP.md](docs/ROADMAP.md).

## API

The API listens on http://localhost:8787 and speaks JSON. Errors look like `{"error": "not_found"}`
with a matching status code.

### Structure

| Who is calling | How it identifies itself | What it may use |
|---|---|---|
| A person in Studio | Sign-in cookie (`POST /auth/login`) | Everything; managing people needs the owner |
| Your server | `Authorization: Bearer mak_...` | Everything except `/auth/*` |
| A visitor on your site | Embed key `pk_...` in the request | `GET /embed/info`, `POST /sessions` for that agent's published version |
| The agent worker | `Authorization: Bearer <service token>` | `/internal/*`, document search, memory notes, starting a conversation |
| Anyone | Nothing | `GET /health`, `GET /auth/status`, signing in |

```bash
curl -H "Authorization: Bearer mak_your_key" http://localhost:8787/agents
```

### Routes

| Method | Path | What it does |
|---|---|---|
| **Accounts** | | |
| GET | `/auth/status` | Whether setup is needed, and who is signed in |
| POST | `/auth/signup` | First run only: create the owner account |
| POST | `/auth/login`, `/auth/logout` | Sign in, sign out |
| POST | `/auth/password` | Change your password (signs your other devices out) |
| GET, POST | `/auth/users` | List people; add one (owner only) |
| DELETE | `/auth/users/{id}` | Remove a person (owner only) |
| GET, POST | `/auth/keys` | List API keys; create one (the secret is shown once) |
| DELETE | `/auth/keys/{id}` | Revoke an API key |
| **Agents** | | |
| GET | `/templates` | Starter templates |
| GET, POST | `/agents` | List agents; create one from a template |
| GET, DELETE | `/agents/{id}` | One agent with its draft, live version and versions; delete it |
| PUT | `/agents/{id}/draft` | Save the draft. Send `x-based-on` (the `updatedAt` you last saw) to avoid overwriting newer edits |
| POST | `/agents/{id}/publish` | Save the draft as a new version and make it live |
| POST | `/agents/{id}/versions` | Save the draft as a version without making it live |
| GET | `/agents/{id}/versions/{n}` | The settings of one version |
| POST | `/agents/{id}/live/{n}` | Make an existing version the live one |
| POST | `/agents/{id}/restore/{n}` | Copy a version back into the draft |
| POST | `/agents/{id}/duplicate` | Copy an agent |
| **Conversations** | | |
| POST | `/sessions` | Start a conversation. Body: `agentId`, `version` (`draft` or `published`), optional `endUserRef`, `embedKey`, `endUserToken`. Returns `livekitUrl` and `token` |
| **Avatars** | | |
| GET, POST | `/avatars` | List models; upload a `.vrm` (raw body, `x-filename` header) |
| GET | `/avatars/files/{file}` | The model file (sign-in, or a signed link) |
| PUT | `/avatars/{file}/thumbnail` | Save a portrait for a model |
| GET | `/avatars/thumbs/{file}` | The portrait |
| DELETE | `/avatars/{file}` | Remove a model from the library |
| **Knowledge** | | |
| GET, POST | `/knowledge` | List documents; upload a file (raw body, `x-filename` header) |
| POST | `/knowledge/text`, `/knowledge/url` | Add a document from text, or from a public web page |
| POST | `/knowledge/search` | Search. Body: `query`, optional `documentIds`, `limit` |
| POST | `/knowledge/{id}/embed` | Retry search-by-meaning for a document |
| DELETE | `/knowledge/{id}` | Remove a document |
| **Memory** | | |
| GET | `/memory` | Notes, all or by `agentId` and `endUser` |
| POST | `/memory`, `/memory/search`, `/memory/restore` | Add a note; find notes; put a removed note back |
| DELETE | `/memory/{id}`, `/memory?endUser=` | Remove a note; forget a visitor |
| **Tools, connectors, webhooks** | | |
| GET, POST | `/tools` | List tools; add one |
| PUT, DELETE | `/tools/{id}` | Change or remove a tool |
| POST | `/tools/{id}/test` | Call a tool now, the way an agent would |
| GET, POST | `/connectors` | List MCP connectors; add one |
| PUT, DELETE | `/connectors/{id}` | Change or remove a connector |
| GET, PUT | `/webhooks` | The webhook address and signing secret; set the address |
| POST | `/webhooks/test`, `/webhooks/rotate` | Send a test event; replace the signing secret |
| GET | `/activity` | Recent tool calls, connector calls, webhook deliveries and hand-offs |
| **Avatar Forge** | | |
| GET, POST | `/forge` | List avatars in the making; start one (signed-in person only). Body: `name`, `consent` |
| GET, DELETE | `/forge/{id}` | One job; throw it away (its picture is deleted, the consent record kept) |
| PUT, GET | `/forge/{id}/image` | Send the picture (JPEG or PNG, raw body, up to 4 MB), which starts the check; get it back |
| POST | `/forge/{id}/review` | Owner only: approve or reject a held picture. Body: `approve` |
| PUT | `/forge/{id}/rig` | Save the five marks on the face. Body: `rig` |
| POST | `/forge/{id}/accept` | Add the finished portrait to the avatar library |
| **Embeds** | | |
| GET, POST | `/embed-keys` | List embed keys; create one for an agent, with allowed sites |
| DELETE | `/embed-keys/{id}` | Remove an embed key |
| GET | `/embed/info?key=` | Public: the agent's name and avatar for an embed |
| POST | `/embed/tokens` | Make a visitor token for one of your users (`endUser`, `ttlMinutes`) |
| **Other** | | |
| GET | `/health` | Public: is the API up |
| GET | `/workspace` | Model, storage and folder settings shown in Studio |

### Calls the platform makes to you

Tool calls and webhooks are `POST` requests with a JSON body and two headers:
`x-metaavatar-timestamp` (seconds) and `x-metaavatar-signature`, which is `sha256=` followed by the
HMAC-SHA256 of `timestamp + "." + body` with your signing secret. Check it before trusting the
request; `verifySignature` in `@metaavatar/sdk/server` does this.

| Call | Body |
|---|---|
| Tool | `{"tool", "arguments", "agentId", "sessionId", "endUser"}`. Answer with text (or JSON) within 8 seconds |
| Webhook `session.ended` | `{"id", "type", "createdAt", "data": {"sessionId", "agentId", "endUser", "durationSec", "reason"}}` |
| Webhook `handoff.requested` | Same shape; `data` has `sessionId`, `agentId`, `endUser`, `reason` |

## Finding your way around the platform

Open http://localhost:3100 and sign in. The menu on the left:

| Section | What you do there |
|---|---|
| **Home** | A six-step walkthrough for your first agent |
| **Agents** | Create an agent, then work through its tabs: Profile, Personality, Voice, Appearance, Knowledge, Memory, Tools, Safety, Versions, Embed. The stage on the right talks to your draft; **Publish** makes it live |
| **Avatars** | The model library. Add your own `.vrm` |
| **Avatar Forge** | Make a talking portrait from one picture of a face: confirm consent, the picture is checked, mark five points on the face, try it, keep it |
| **Voices** | Listen to the voices and pick one |
| **Knowledge** | Add documents and try questions against them |
| **Playground** | Talk to any agent with performance readouts; the lip-sync test works without Gemini |
| **Tools** | Add your tools and MCP connectors; see every call agents made |
| **Embed and API** | Code for your website, the webhook address, the signing secret, the API |
| **Memory** | Everything agents remember about visitors, with Forget |
| **Safety** | The rules every agent follows |
| **Settings** | Your password, the people in the workspace, API keys, model settings |
| Conversations, Usage | Planned (they show what is coming) |

To put an agent on a website: publish it, open its **Embed** tab, create an embed, and paste the
two lines before `</body>`:

```html
<script src="http://localhost:3100/widget.js" async></script>
<meta-avatar embed-key="pk_..." label="Talk to us"></meta-avatar>
```

## Guides

- [Platform guide](docs/PLATFORM_GUIDE.md): how to use Studio, step by step, for new users
- [Architecture](docs/ARCHITECTURE.md): system design, decisions, latency budget, safety
- [Implementation guide](docs/IMPLEMENTATION_GUIDE.md): build plan, acceptance criteria, lessons
- [Roadmap](docs/ROADMAP.md): what is done, what is left, and the plan for every phase
- [Avatar models](assets/avatars/README.md): where to get models, licences, how to add one
- [CLAUDE.md](CLAUDE.md): working rules for AI coding assistants in this repository
- Settings you can change: [.env.example](.env.example)

## Contributing

1. Read [CLAUDE.md](CLAUDE.md) (the working rules apply to people too) and the roadmap.
2. Create a branch. Keep one change to one purpose.
3. Change schemas first: `packages/protocol`, then `make protocol`, then the API, the worker, Studio.
4. Add a test for every API change (`services/api/src/*.test.ts`) and every piece of worker logic
   (`services/agent-worker/tests/`). Tests never call Gemini or LiveKit.
5. Try the change in the running app, not only in tests.
6. Run `make check`. `make hooks` turns on a pre-commit hook that runs lint and typecheck; CI runs
   `make check` on every push and pull request.
7. Update the docs in the same change: the roadmap for status, the platform guide for anything a
   user sees, this README for commands and routes, `.env.example` for new settings.
8. Never commit `.env`, `data/` or avatar models, and never delete a model from `assets/avatars/`.
