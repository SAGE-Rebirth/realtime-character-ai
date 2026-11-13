# MetaAvatar — Implementation Guide

Companion to [ARCHITECTURE.md](./ARCHITECTURE.md). This is the build order: what to build, in which
sequence, and how we know each phase is done.

**Guiding principle: build the thinnest end-to-end loop first** (talk → Gemini → avatar speaks with
synced lips), measure it, then widen. Every later feature plugs into that loop.

**Everything is built in-house.** No paid avatar, rendering, voice or 3D-generation platforms: our own
renderers and model servers, open-source infrastructure we host ourselves, and open-weight models
with commercial-use licences as starting points. The only external service is the Gemini Live API.

---

## 0. Current budget profile: one MacBook M4 (24 GB) + free tiers, ≤ $20/month

Until there is funding for GPUs, we build **demo-grade** versions of every feature on the laptop and
free tiers. The production architecture stays the target; each piece below is a stand-in that plugs
into the same interfaces (`RealtimeModel`, `AvatarRenderer`, `ForgeModel`), so nothing is thrown away.

| Need | Free / laptop choice | Notes and limits |
|---|---|---|
| AI brain | **Gemini Live API, free tier** (Google AI Studio key) | Limits are per project, refresh daily, and change often; check your limits in AI Studio. Free-tier data may be used by Google to improve products, so **demos only, no real users' private data**. Gemini API terms require users to be 18+, so no kid-facing demos on this tier. |
| Realtime transport | **LiveKit server, self-hosted on the Mac** (open source, `livekit-server --dev`) | For sharing demos online: LiveKit Cloud's free Build plan (1,000 agent-session minutes a month, 5 concurrent sessions at last check). The agent worker can still run on the Mac. |
| Agent worker, API, Studio | Run locally (Python + Node) | Docker Desktop or OrbStack (free for personal use) for Postgres + pgvector, Redis, MinIO; about 3–4 GB RAM. |
| 3D full-body avatar | **Our Three.js runtime** (WebGPU in the browser; an M4 holds 60 fps easily) | Free assets: VRoid Studio (make stylized VRM characters), CC0/CC-BY VRM models, Mixamo (free auto-rig + animation clips, usable in projects but raw files can't be redistributed), Blender for ARKit face shapes. |
| **Photoreal avatar from one photo** | **LAM** (open-source, Alibaba Tongyi Lab, SIGGRAPH 2025): one image → animatable 3D Gaussian head; renders in real time in the browser via its WebGL SDK (110+ fps reported on a phone); its Audio2Expression model drives it from audio | Head/bust only, no tongue. Building the avatar takes ~1.4 s on an A100; on the Mac try CPU/MPS, else run it once per avatar on a free Colab/Kaggle GPU. It's driven by the FLAME face model, which has its own licence (research use), so **fine for demos, needs a licence review before commercial use**. Confirm the repo's licence file too. |
| Lip-sync (3D) | Our spectral viseme engine in the browser | Free, runs anywhere. |
| Voices | Gemini prebuilt voices | Custom voices later: small open TTS models (e.g. Kokoro-82M, Apache-2.0) run fine on an M4 but don't clone voices. |
| Image → 3D character (Forge) | Open image-to-3D models via free Hugging Face Spaces or a free Colab GPU, Mixamo for rigging | Demo quality; one avatar at a time. |
| Knowledge base | pgvector locally + Gemini embeddings (free tier) or a local embedding model | |
| GPU experiments | Free Google Colab and Kaggle notebook GPUs | Session and weekly limits apply. |
| Sharing a demo | Cloudflare Tunnel (free) from the Mac, or the free tiers of static hosting for the frontend | |

**What doesn't fit this budget** (stays in the plan for later): neural *video* generation (N2/N3, which
needs data-centre GPUs and can't train or run in real time on 24 GB unified memory), cloud
deployment (GKE, Terraform), billing, SOC 2, and kid-facing launches.

**Where the $20 goes, if needed**: spend nothing at first. If a real blocker appears, the best value
is either a GPU notebook subscription (e.g. Colab Pro) for avatar building and model experiments, or
paid Gemini API usage for demo days when free limits are too tight. Decide when we hit the limit.

**Laptop plan in practice**: the 3D path (full body) and the LAM path (photoreal head from one photo)
both render on the viewer's device, so they cost nothing per minute and need no server GPU. That gives
us both "realistic from one image" and "full-body animation" for demos with zero spend.

---

## 1. Repository layout

```
realtime-ai-agents/
├─ apps/
│  └─ studio/                 # Next.js — dashboard, persona builder, playground, billing
├─ services/
│  ├─ api/                    # Hono (TS) — control-plane + public session API
│  ├─ agent-worker/           # Python — LiveKit Agents + Gemini Live, tools, guardrails, memory
│  ├─ neural-engine/          # Python + CUDA — our real-time neural video avatar server
│  ├─ voice/                  # Python — our self-hosted TTS (designed + cloned voices)
│  ├─ avatar-forge/           # Python — image → Avatar Package (GPU jobs)
│  └─ ingest/                 # Python — knowledge-base ingestion
├─ ml/
│  ├─ data/                   # dataset tooling: consent tracking, filtering, preprocessing
│  ├─ training/               # neural avatar model training + distillation
│  └─ eval/                   # lip-sync, identity, realism, latency benchmarks
│  └─ licenses.yaml           # registry of every model/dataset and its licence
├─ packages/
│  ├─ avatar-runtime/         # TS — renderer, animation, lip-sync, transport, event bus
│  ├─ embed/                  # TS — <meta-avatar> web component + iframe loader
│  ├─ sdk-js/                 # TS — client SDK (sessions, events) for customers
│  ├─ protocol/               # Zod schemas: data-channel events, agent config → codegen to Pydantic
│  └─ ui/                     # shared shadcn components
├─ assets/
│  ├─ avatars/                # preset Avatar Packages (dev only; prod in object storage)
│  └─ animations/             # canonical-skeleton clip library (licensed/owned only)
├─ infra/
│  ├─ docker/compose.yaml     # postgres+pgvector, redis, livekit-server, minio
│  └─ terraform/              # GCP: GKE, Cloud Run, Cloud SQL, GCS/CDN, Pub/Sub
├─ evals/                     # guardrail red-team suites, lip-sync golden tests, latency harness
└─ docs/
```

Tooling: pnpm + Turborepo, TypeScript strict, ESLint/Prettier, Vitest, Playwright; Python 3.12 with
uv, ruff, mypy, pytest. GitHub Actions: lint → typecheck → test → build → deploy (per environment).

---

## 2. Phase plan

Progress and open tasks for each phase are tracked in [ROADMAP.md](ROADMAP.md).

| Phase | Goal | Size* |
|---|---|---|
Two tracks run in parallel and meet at the `AvatarRenderer` interface.

**Product track** (platform + 3D renderer)

| Phase | Goal | Size* |
|---|---|---|
| 0 | Foundations: monorepo, self-hosted local stack, CI, protocol package | ~1 wk |
| 1 | **Core loop MVP**: Gemini Live agent + our full-body 3D avatar, synced lips, body states, barge-in; `AvatarRenderer` interface ready for the neural engine | ~3 wks |
| 2 | **Persona Studio**: agents as config — names, appearance, voices (Gemini prebuilt; designed + cloned via our TTS), instructions, grounding, KB, memory | ~3–4 wks |
| 3 | **Interaction surface**: vision (camera + screen share), tools & MCP connectors, widget + React SDK, public API, meeting bot | ~4 wks |
| 4 | **Avatar Forge** (3D): avatars from image / character references with self-hosted models | ~4–6 wks |
| 5 | **Safety & compliance hardening** (gate before any external user) | ongoing, gate ~2 wks |
| 6 | **Production readiness**: billing/metering, observability, load/scale, SOC 2 path | ~3 wks |
| 7 | **Vertical packs**: education, support, training simulations, meeting displays, gaming SDK | per vertical |

**Neural track** (our Neural Avatar Engine — Architecture §6.2–6.3)

| Stage | Goal | Size* |
|---|---|---|
| N0 | Eval harness + data pipeline: metrics, benchmark set, consent-tracked data tooling, licence registry | ~2–3 wks |
| N1 | **Lite engine**: single-GPU real-time talking portrait from one image, live in the product | ~6–8 wks |
| N2 | **Pro engine**: distilled streaming diffusion model, any style, ≤ 37 ms/frame at 720p | ~3–6 months |
| N3 | **Own foundation model**: upper body + hands, emotion control, trained on our licensed data | 6+ months |

\*Rough sizes for a small team (2–4 product engineers + 1–3 ML engineers); refined after Phase 1 and
N0 measurements. The neural track needs GPU access from day one (see Open decisions).

---

## Phase 0 — Foundations

**Build**
1. Monorepo skeleton (layout above), shared configs, `.env.example`, secrets via `direnv`/1Password.
2. `infra/docker/compose.yaml`: Postgres 16 + pgvector, Redis, `livekit-server --dev`, MinIO.
3. `packages/protocol`: Zod schemas for data-channel events and `AgentConfig`; script that generates
   Pydantic models for the worker (single source of truth across TS/Python).
4. CI pipeline; pre-commit hooks; conventional commits.

**Done when**: `pnpm dev` + `uv run` bring up everything locally; CI green on an empty app.

---

## Phase 1 — Core loop MVP (the most important phase)

### 1a. Agent worker (Python)
1. LiveKit Agents worker that joins a room on dispatch.
2. Gemini Live session via the Google realtime plugin, behind our own `RealtimeModel` interface.
   Config: model id from env, prebuilt voice, system instructions, automatic activity detection,
   input + output transcription **on**, context-window compression **on**, session resumption **on**.
3. Publish agent audio track; forward `interrupted` → `agent.flush` event; publish
   `agent.state` (`listening/thinking/speaking`) and streamed transcripts on the data channel.
4. Handle `goAway` / reconnect with resumption handle transparently.

### 1b. 3D path — Avatar Runtime (TS)
1. Three.js scene: WebGPU renderer with WebGL2 fallback, studio lighting, camera framing (full body
   and portrait presets), GPU tier detection → quality preset.
2. Load a **preset Avatar Package** (GLB, VRM-named humanoid bones, ARKit 52 blendshapes). Start with
   one or two characters we model ourselves or that are free with a commercial-use licence (e.g.
   CC0/CC-BY VRM models); no paid avatar services.
3. Animation system: base state machine (idle / listening / thinking / speaking) with crossfades,
   procedural blink + saccades + breathing + head look-at; retargeting from the canonical clip set.
4. Audio pipeline: subscribe to agent audio → AudioWorklet **delay line (~40 ms)** → speakers +
   lip-sync analyser. Lip-sync **L1** (spectral → visemes → ARKit weights) with smoothing/coarticulation.
5. Prosody-driven beat gestures + head nods from speech energy.
6. Barge-in: on `agent.flush`, drain audio buffer, ease mouth closed (< 100 ms), back to `listening`.
7. Dev HUD: fps, frame time, A/V offset, voice-to-voice latency, connection stats.

### 1c. Renderer interface + minimal API + playground
1. `AvatarRenderer` interface (3D implementation now; the neural engine plugs in at N1): the worker
   emits speech audio + state/emotion events, the renderer turns them into what the user sees.
2. `POST /sessions` → creates a room on our self-hosted LiveKit, mints token, dispatches worker with
   agent config (hard-coded agent for now).
3. Playground page in Studio: connect, mic permission, captions, mute, text fallback, "AI" disclosure
   badge from day one.

**Done when (acceptance criteria)**
- Hold a 20-minute conversation without a visible reconnect.
- Voice-to-voice p50 **≤ 1.0 s**, measured by the latency harness.
- A/V offset ≤ 37 ms p95 (click-track test); ≥ 60 fps on an M-series laptop, ≥ 30 fps p5 on a
  mid-range Android (reference device list in `evals/`).
- Interrupting the avatar mid-sentence stops speech in < 200 ms.
- Measured cost per active minute recorded in the doc.

**Status (12 Nov 2026, MacBook M4, Gemini free tier, `gemini-3.1-flash-live-preview`)**

Measured with `make eval` (`evals/latency.py`): a scripted user joins a real session, speaks with
macOS text-to-speech, types, and talks over the agent. Five voice turns per run, several runs.

| Criterion | Result | Status |
|---|---|---|
| Voice-to-voice p50 ≤ 1.0 s | **1.12 s** p50 (0.95–1.27 s per turn). About 0.5 s is the deliberate end-of-turn silence wait (`TURN_SILENCE_MS=500`); the rest is Gemini's time to first audio. Thinking level `minimal` saved ~0.2 s; dropping the silence wait to 350 ms saved only ~0.09 s and risks cutting users off, so it stays at 500 ms. | Close, not met |
| Interruption stops speech < 200 ms | Agent audio stops **0.04 s** after the interruption is detected (`agent.flush`); detection itself takes ~0.46 s of the user talking (Gemini's server-side speech detection). | Met |
| A/V offset ≤ 37 ms | ~29 ms lips-vs-sound on the playground HUD (lip-sync test with synthesized vowels) | Met |
| ≥ 60 fps on an M-series laptop | 0.42 ms per frame (`__avatar.benchmark()`), so the display rate is the limit | Met |
| ≥ 30 fps p5 on a mid-range Android | Not measured (no reference device yet) | Open |
| 20-minute conversation without visible reconnect | Not run yet. Context compression and session resumption are on. | Open |
| Cost per active minute | $0 on the free tier: LiveKit is self-hosted and the 3D avatar renders on the viewer's device. Gemini's paid per-minute price to be recorded when we move off the free tier. | Recorded (free tier) |

Also done in Phase 1: the `AvatarRenderer` interface (`packages/avatar-runtime/src/renderer/`) with
`ThreeRenderer` as the first implementation; text chat in the playground, which also works when the
microphone is blocked; and the "AI" badge on the stage.

---

## Phase 2 — Persona Studio (options from the brief)

1. Auth (Studio), organizations, members, RBAC.
2. **Agents CRUD with versioning** (draft → publish); worker loads published version by id.
3. **Names & personality**: name, role, greeting, instructions, language, tone sliders that compile
   into instructions.
4. **Voices**: Gemini prebuilt voice catalog with preview clips; per-agent language. **Custom voice**:
   our `services/voice` — self-hosted open-weight TTS (commercial-use licence, streaming, GPU) for
   voices designed from a text prompt or cloned from a sample, with Gemini Live in text-output mode
   (half-cascade, extra latency shown in Studio). Cloning requires a consent recording from the voice
   owner. Run a short bake-off of open TTS models on quality, latency and licence first.
5. **Appearance**: preset gallery, outfit/material variants and framing for 3D (Forge plugs in at
   Phase 4); "Drop an image → pick a voice → talk" flow switches on when the neural engine reaches N1
   (consent + safety scan first).
6. **Grounding & search**: toggle Google Search; show citations in captions.
7. **Knowledge base**: upload PDFs/Docs/URLs → `ingest` service → pgvector; `search_knowledge_base` tool
   with source ids; KB test console in Studio.
8. **Memory**: opt-in per agent; `remember`/`recall` tools; post-session summarizer job; end-user
   "forget me".
9. **Semantic gestures/emotions**: transcript-based planner in the worker + `express()` non-blocking
   tool; expand clip library (greeting, explain, count, point, shrug, celebrate, think).

**Done when**: a non-engineer creates two distinct personas (different name, voice, avatar, KB) in
Studio and both work in the playground with grounded, cited answers.


**Status (13 Nov 2026): knowledge base added; memory, accounts and custom voices left**

| Item | State |
|---|---|
| Studio shell | Done. Every roadmap feature has a place in the navigation (Build, Test, Connect, Operate, Settings); unbuilt ones show what's coming and in which phase. |
| 2. Agents with versions | Done. Draft autosaves; Publish creates numbered versions; roll back by copying a version into the draft. Store is a JSON file under `data/` behind `AgentStore`, ready to swap for Postgres. |
| 3. Names and personality | Done. Name, role, greeting, language, instructions, and four tone sliders the worker turns into instructions. Five starting templates (blank, tutor, support, meeting host, game character). |
| 4. Voices | Prebuilt done: all 30 Gemini voices with samples (`make voices`). Custom and cloned voices not started. |
| 5. Appearance | Done for 3D: built-in character plus uploaded VRM library, and camera framing. Image-to-avatar waits for Phase 4. |
| 6. Grounding | Done: Google Search toggle per agent. Citations in captions not yet. |
| Live test | Done. The editor's stage talks to the draft; editing mid-call offers a restart. |
| 1. Auth, orgs, RBAC | Not started. |
| 7. Knowledge base | Done for the laptop profile. Documents (PDF, Word, text, Markdown, HTML, web pages, pasted text) are split into passages of about 900 characters and embedded with `gemini-embedding-001`; search merges a ranking by meaning with a ranking by shared words, and falls back to words alone when embeddings are unavailable. The worker's `search_knowledge_base` tool returns passages with their document, the stage shows the document name under the captions, and Studio has a library, a per-agent picker and a test console. Differences from the plan: the index is files under `data/knowledge/` behind `KnowledgeStore` rather than pgvector, and ingestion runs inside the API rather than a separate `services/ingest`. Both move when the stores go to Postgres. |
| 8. Memory | Not started. |

---

## Phase 3 — Interaction surface

1. **Vision**: camera and **screen share** → frames to Gemini (tutoring, demos, games, design
   feedback); 3D avatar gaze follows user's face (on-device face landmarks, no frames stored).
2. **Tools**: two kinds, as in the reference product — **UI actions** executed in the client (show
   captions, pop a quiz/trivia card, update game state) and **trusted backend RPCs** (e.g.
   `fetch_order_status`) whose results feed back into the conversation. Tenant HTTP tools use JSON
   schema, HMAC-signed webhooks, timeouts and confirm-before-act; built-ins: `show_card`,
   `handoff_to_human`, `end_session`.
3. **Connectors (MCP)**: MCP client in worker; per-tenant OAuth; tool allowlist per agent; audit log.
4. **Embeddable widget**: `<meta-avatar>` web component + iframe; publishable keys with allowed
   origins; theming; mobile layout; ≤ 150 KB initial JS, avatar streamed progressively.
5. **Public API + SDKs**: React SDK (`<AvatarCall agentId connectUrl />`-style component), JS SDK,
   LiveKit Agents integration for customers who run their own agent, server-side end-user identity
   tokens, webhooks (`session.ended`, `safety.event`, `handoff.requested`).
6. **Meeting integration**: bot joins Zoom / Google Meet / Teams, sees and hears the room, answers when
   addressed; publishes the avatar as its camera.

**Done when**: a customer pastes one snippet on their site and gets a working, tool-using, camera- and
screen-aware avatar restricted to their domain, and the same agent can join a Meet call.

---

## Phase 4 — Avatar Forge (image / character reference → avatar)

1. Upload flow with **consent & rights attestation**; selfie flow with liveness for "avatar of me".
2. Safety scan service (CSAM hash matching via an industry hash-sharing programme — these are free for
   qualifying platforms and a legal necessity, not a rendering platform — plus our own minor-detection
   and public-figure checks) — blocks before any processing.
3. Model abstraction `ForgeModel` (self-hosted open-weight models, our own code where licences don't
   fit) with two paths:
   - **Person photo** → head reconstruction → fit to canonical body template.
   - **Character art** → image-to-3D → auto-rig to canonical skeleton.
4. ARKit blendshape transfer from template; optimization (LODs, KTX2, meshopt); automated QA renders +
   animation smoke test (every gesture clip plays without broken skinning).
5. Studio UI: job progress, preview turntable, accept/regenerate, publish.
6. **Tier B R&D spike** (parallel): Gaussian-splat head in WebGPU driven by ARKit weights; go/no-go on
   quality and mobile fps.

Evaluate open-weight models for each step (quality, licence for commercial use and territories,
GPU cost per job, latency) in a short bake-off before committing; no paid image-to-3D APIs.

**Done when**: from one front-facing photo (with consent) or one character illustration, a usable
avatar is produced in < 10 minutes that passes QA and plays every gesture.

---

## Phase 5 — Safety & compliance hardening (release gate)

1. Platform safety preamble + audience profiles (`general`, `teen`, `kids`) enforced in worker.
2. Streaming moderation of input/output transcripts → interrupt + redirect + `safety_event`.
3. **Strict mode** (half-cascade with pre-speech moderation) for `kids`.
4. Crisis protocol (self-harm, abuse disclosure) with resources and tenant escalation webhook.
5. Kids-mode feature locks (no memory, no open search, time limits, no companion personas).
6. Red-team eval suite in `evals/` (jailbreaks, persona overrides, PII extraction, tool abuse, unsafe
   content for minors) run in CI on every prompt/policy change; publish pass rates internally.
7. Compliance features: AI disclosure (EU AI Act Art. 50), media provenance marking, retention
   settings, DSAR export/delete, consent records, DPA + sub-processor list, region pinning.
8. **Legal review** of: Gemini/Vertex terms for minors, biometric consent flows, likeness rights,
   recording consent, animation/model licenses. Nothing kid-facing ships before sign-off.

**Done when**: red-team suite ≥ agreed thresholds, legal sign-off recorded, Kids mode verified by an
external reviewer.

---

## Phase 6 — Production readiness

- Multi-tenant quotas, our own usage metering (audio/video minutes per renderer, GPU minutes, Forge jobs), plan limits; a payment processor only to charge customers.
- OpenTelemetry end-to-end, dashboards for every SLO in the architecture doc, alerting, on-call runbooks.
- Load test: synthetic LiveKit "user bots" playing fixture audio at N concurrent sessions; find
  sessions-per-worker and SFU limits; chaos tests (Gemini disconnects, tool timeouts).
- Terraform for staging + prod on GCP; blue/green worker deploys that drain sessions gracefully.
- Security: SSO for Studio, audit logs, secrets in KMS, dependency scanning, external pen-test.

---

## Phase 7 — Vertical packs

| Vertical | Pack contents |
|---|---|
| Education | Tutor templates, LTI 1.3, curriculum KB import, whiteboard cards, teacher dashboard, Kids mode default |
| Customer support | Zendesk/Freshdesk/Salesforce connectors via MCP, human handoff, CSAT, PII redaction |
| Meeting displays | Meeting-bot polish (standups, customer calls), kiosk mode with wake word |
| Training simulations | Role-play personas for sales coaching, interview prep, management training, onboarding; scoring + feedback report |
| Gaming & entertainment | Unity + Unreal runtime SDKs consuming the same protocol and Avatar Package; NPC tool bindings |

---

## Neural track — our Neural Avatar Engine

Runs in parallel with the product track, owned by the ML engineers. Architecture §6.2–6.3 has the
design; this is the build order.

**On the current laptop budget** only N0 (eval harness, licence registry) and the LAM Gaussian-head
option (Architecture §6.3b) are in scope. N1–N3 video-generation stages start when GPU budget exists;
small N1 experiments can run on free Colab/Kaggle GPUs meanwhile.

### N0 — Foundations (start alongside Phase 0)
1. **GPU access** sorted (cloud GPU node pool or on-prem); experiment tracking; model registry.
2. **Eval harness** (`ml/eval`): lip-sync accuracy (sync-confidence metrics), identity similarity
   over time, image quality, temporal flicker, human preference tests, **ms/frame** and
   **first-frame latency**. Every model is scored on the same benchmark set.
3. **Data pipeline** (`ml/data`): consent and licence tracking per clip, face/speaker filtering,
   audio-video sync checks, preprocessing. Start collecting consented talking-head recordings.
4. `ml/licenses.yaml`: every model, checkpoint and dataset with its licence; CI fails if a
   non-commercial artefact enters a production image.

### N1 — Lite engine (first in-product neural avatar)
1. Bake-off of open-weight real-time talking-portrait approaches (keypoint/warping animators,
   mouth-region generators, audio→motion models) on the eval harness; replace any non-commercial
   sub-components (e.g. face detectors) with our own or permissive ones.
2. `services/neural-engine` server: joins LiveKit room, audio in → frames out, NVENC encode, audio
   re-timing, idle/listening motion when silent, barge-in flush, identity cache.
3. GPU scheduler with admission control and fallback to the 3D path.
4. Plug into `AvatarRenderer`; Studio gets "Drop an image → talk".

**Done when**: one uploaded photo becomes a talking character in < 1 minute; ≥ 25 fps at 512–720p;
several concurrent sessions per GPU; voice-to-voice p50 ≤ 1.5 s.

### N2 — Pro engine (Runway-class quality)
1. Start from Apache-2.0 streaming audio-driven diffusion weights (e.g. Alibaba-Quark Live Avatar);
   reproduce its numbers on our hardware.
2. **Distil** into a smaller few-step student (self-forcing-style distillation), fine-tune on our
   licensed data, extend to cartoon/creature/mascot styles.
3. Real-time serving: chunked autoregressive generation, denoiser/decoder overlap on separate
   GPUs or streams, KV-cache eviction, CUDA Graphs, TensorRT, fused Triton kernels.

**Done when**: ≤ 37 ms/frame at 720p, 24 fps+, first frame ≤ 600 ms after audio starts, stable
identity over a 1-hour session, GPU cost per minute within budget.

### N3 — Own foundation model
Train our own model on licensed + consented data: upper body and hands, emotion and gesture control
driven by the worker's `express()` events. Ships when it beats N2 on human-preference tests.

---

## 3. Testing strategy

| Layer | Tests |
|---|---|
| Protocol | Schema round-trip tests TS ↔ Python |
| Runtime | Vitest units (animation blending, viseme mapping); Playwright visual snapshots of avatar poses; fps benchmark on device farm |
| Lip-sync | Golden tests: fixture audio → blendshape curves within tolerance; A/V offset click-track test |
| Worker | pytest with a fake `RealtimeModel` (scripted audio/transcripts/tool calls); reconnect/goAway tests |
| End-to-end | Latency harness: bot joins room, speaks fixture, measures end-of-speech → first agent audio |
| Safety | Red-team eval suite in CI; regression on every policy/prompt change |
| Load | Concurrent synthetic sessions, soak tests (2 h), chaos |
| Neural engine | Eval harness scores on every checkpoint; ms/frame and first-frame latency regression tests; identity-drift soak test (1 h); licence-registry check in CI |

## 4. Risks & mitigations

| Risk | Mitigation |
|---|---|
| "37 ms" read as total response time | Documented as time per frame; voice-to-voice tracked separately with honest targets |
| Matching Runway-class realism with our own model is a research effort | Staged N1 → N2 → N3 so something ships early; start from strong open weights; eval harness keeps progress measurable |
| GPU cost and availability for training and serving | Distillation to small students, several sessions per GPU at N1, scheduler with 3D fallback, cost tracked per minute |
| Open-weight licences (non-commercial pieces, territory limits) | Licence registry enforced in CI; replace restricted components with our own |
| Training data rights | Consent-tracked collection with release forms; licensed datasets only |
| Gemini Live model churn (preview ids, deprecations) | Model id is config; `RealtimeModel` interface; contract tests on each new model |
| Session time limits & disconnects | Compression + resumption + transparent reconnect from Phase 1 |
| Output can't be pre-moderated in speech-to-speech | Streaming interrupt + Strict (half-cascade) mode for kids |
| Provider terms for under-18 use | Vertex AI + legal review before any kid-facing launch |
| Likeness abuse / deepfakes from Forge | Consent + liveness, public-figure & minor blocks, provenance marking, takedown process |
| Licensing of avatars, animations, 3D models | Only our own or free commercially licensed assets; tracked in `ml/licenses.yaml` |
| Cost per minute | Metering from day one; per-plan caps; cheaper model tiers per agent |
| Brand conflict with "Meta" | Choose final name before public launch |

## 5. Open decisions (need your call)

1. **Budget** — settled for now: MacBook M4 24 GB + free tiers, ≤ $20/month (§0). Neural video
   (N2/N3) waits until there is GPU budget.
2. **Rendering paths** — both, 3D first and neural in parallel *(recommended)*, vs. neural only.
3. **Cloud** — GCP with Vertex AI *(recommended, pairs with Gemini)* vs. other / on-prem.
4. **First vertical** to polish after the core — education, support, training, meetings, or gaming.
5. **Final product name.**

## 6. First sprint checklist (laptop profile)

- [ ] Phase 0 scaffold + Docker stack on the Mac (Postgres+pgvector, Redis, LiveKit server, MinIO)
- [ ] `packages/protocol` with event + AgentConfig schemas
- [ ] Agent worker: Gemini Live (free tier) over local LiveKit, transcripts, interruptions
- [ ] Avatar runtime: Three.js renderer, free VRM avatar, idle/listen/speak states, L1 lip-sync via delay line
- [ ] `AvatarRenderer` interface + `POST /sessions` + Studio playground page with latency HUD
- [ ] Spike: build one LAM head from a photo (Mac, else free Colab) and render it in the browser driven by our agent's audio

Prerequisites from you: a Gemini API key from Google AI Studio (free), Docker Desktop or OrbStack, and
Node 22 + Python 3.12 on the Mac. No paid accounts.
