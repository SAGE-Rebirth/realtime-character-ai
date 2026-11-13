# MetaAvatar — Roadmap and open work

Status as of 13 November 2026. This is the working checklist: what is done, what is left over from
finished phases, and the tasks for every phase still ahead. The *why* and *how* behind each phase
live in the [Implementation Guide](IMPLEMENTATION_GUIDE.md) and [Architecture](ARCHITECTURE.md);
this file tracks progress against them.

**Budget profile:** one MacBook M4 (24 GB), Gemini Live free tier, self-hosted LiveKit, at most
$20 a month and nothing spent so far. Tasks marked 💻 fit that profile. Tasks marked 💰 need GPU,
cloud or paid-plan budget and wait until it exists.

---

## At a glance

| Phase | Goal | State |
|---|---|---|
| 0 | Foundations: monorepo, local stack, protocol, CI | **Done**. CI has not run on GitHub yet |
| 1 | Core loop: Gemini Live agent + 3D avatar, lip-sync, barge-in | **Mostly done**: 4 of 6 acceptance checks met |
| 2 | Persona Studio: agents as configuration | **Mostly done**: knowledge base and memory built; accounts and custom voices left |
| 3 | Interaction surface: vision, tools, widget, API, meetings | Not started (Studio pages planned) |
| 4 | Avatar Forge: avatar from a photo or character art | Not started |
| 5 | Safety and compliance hardening (release gate) | Partly done: platform rules and audiences |
| 6 | Production readiness | Not started |
| 7 | Vertical packs | Not started (starter templates exist) |
| N0–N3 | Neural Avatar Engine | Not started |

---

## Leftover jobs from finished work

Do these before, or alongside, the next phase. Each one is small.

### Housekeeping
- [ ] **Commit the current work.** The Phase 1 gap fixes, the new Studio and Phase 2 so far are all
  uncommitted on `main`; the last commit is `f2e15e8`.
- [ ] **Push to GitHub and get CI green.** `.github/workflows/ci.yml` runs `make check`. It has
  never run there, so the first run may need small fixes (pnpm version, cache paths).
- [ ] **Finish the voice samples.** 12 of 30 clips exist in `apps/studio/public/voices/`. Run
  `make voices`: it only fills the missing ones. Free-tier text-to-speech limits make it slow, so
  it may take a day or two of runs.
- [ ] Turn on the pre-commit hook on each machine: `make hooks`.

### Quality pass, 13 November 2026
Every Studio page and setting was exercised in the browser (create, edit each panel, switch voice,
avatar and camera, publish, discard, delete, knowledge add/search/remove, playground switches,
phone width). Fixed along the way:
- [x] The built-in character showed for a moment before a VRM avatar on every page load.
- [x] A browser tab holding an older copy of an agent could overwrite newer edits; such saves are
  now refused with a "reload" message.
- [x] No way to throw away draft changes when only one version was published.
- [x] Avatar models now live in `assets/avatars/` under their own file names; Studio shows each
  model's path, licence and source.
- [x] Gestures and expressions can be played from the Appearance panel and the Avatars page (they
  were only at the bottom of the Playground).
- [x] Page title was lost when moving between editor panels; an aborted audio set-up logged errors.
Still open from this pass: 16 of 30 voice samples are missing (`make voices`), and live
conversations were not re-run because the Gemini quota was used up.

### Quality, performance and security pass, 13 November 2026 (evening)
Measured on the MacBook M4 against the running stack.

| Check | Result |
|---|---|
| API speed, 50 requests at once | Agent list and detail 14,000–20,000 requests/s, p95 5–6 ms; avatar list 6,000/s; memory search 15,000/s; no errors |
| Document search | p50 0.41 s, p95 0.76 s. Almost all of it is the call to Gemini that embeds the question |
| 10 MB avatar download, 8 at once | p95 82 ms (was 430 ms before files were streamed) |
| API memory under repeated load | Settles near 390 MB under `make start` (was growing past 600 MB: each avatar download was read into memory). In Docker, idle: 76 MB |
| Process sizes, idle | Docker: API 76 MB, Studio 52 MB, LiveKit 35 MB, worker 732 MB (it keeps a pool of ready processes). Local dev: API 170 MB, Studio 330 MB |
| Browser, 12 avatar swaps | No leak: GPU geometries and textures unchanged; 0.26 ms per frame |
| Live voice through the Docker stack | Reply 0.97 s and 1.05 s; typed reply 0.78 s; barge-in stops speech in 0.03 s; no missed turns |
| Dependency audit | Node: one moderate issue in `@hono/node-server`, fixed by upgrading to 2.1.6. Python: none known |
| Containers | Run as a non-root user; the Gemini key is not in any image layer; ports are published on this machine only |

Security changes made: the API answers this machine only unless `API_HOST=0.0.0.0` is set; safe
response headers; a 2 MB limit on JSON bodies; starting conversations is limited to 30 a minute
and fetching web pages to 20 a minute per caller; LiveKit's ports are no longer open to the
network.

Security gaps that remain (all need the accounts work): **no sign-in**, so anyone who can reach
Studio or the API can read and change everything, including visitors' memories; the worker calls
the API without credentials; rate limits are per process and in memory; web-page fetching checks
the address but not what it resolves to; LiveKit runs with its public development keys.

### Verification not done yet
- [ ] **Knowledge base with real documents**: tested with a short PDF, a Word file and one web page.
  Try a long manual (100+ pages), a scanned PDF (expected to be refused with a clear message) and
  questions in another language, and check the `KNOWLEDGE_MIN_SIMILARITY` level (0.58, measured on
  a small sample) still separates related from unrelated passages.
- [ ] **Spoken questions to a knowledge agent**: the document lookup was tested with typed
  questions only.
- [ ] **Test with a real microphone** in Chrome and Safari: start a conversation, talk over the
  avatar, mute and unmute. Every voice test so far used a scripted voice or typed messages.
- [x] **Load a real VRM model**: done 13 November 2026 with pixiv's VRM 1.0 sample
  (`VRM1_Constraint_Twist_Sample`, VRM Public License 1.0, commercial use allowed), in the library
  as "Mira". Lip-sync with the live voice, blinks, emotions, hair physics and the gestures tried
  (wave, explain, think) all work at 60 fps. Testing VRM 0.x models found and fixed a bug: their
  arms pointed straight up.
- [ ] **A professional-looking avatar** (an adult in a suit, a teacher): none found that can be
  downloaded without signing in. VRoid Hub has many (search "teacher" or "suit", then "Filter by
  conditions of use"), but downloads need a pixiv account. Any `.vrm` copied into
  `assets/avatars/` appears in Studio; see `assets/avatars/README.md`.
- [ ] Gesture clips were tuned on the built-in character: on VRM models the "think" hand lands on
  the cheek. Retune per body proportions, or retarget real clips.
- [ ] **Check the voice change end to end**: the worker now logs `voice=` when a session starts, but
  nobody has confirmed by ear that a changed voice is used.
- [ ] **Light and dark mode, phone and tablet**: checked on a few pages only.

### Phase 1 acceptance checks still open
- [ ] **Reply time**: p50 is 1.12 s against a 1.0 s target (`make eval`). About 0.5 s is the
  deliberate end-of-turn wait. Options: try `gemini-3.8-live` when it reaches the free tier, retest
  `TURN_SILENCE_MS=400` with real users, and measure on wired internet.
- [ ] **20-minute conversation without a visible reconnect**: add a `--soak 20` mode to
  `evals/latency.py` and run it once (uses free-tier quota).
- [ ] **≥ 30 fps on a mid-range Android phone**: needs a device; open the Playground on it
  and read the frame rate.
- [ ] **Session-limit reconnect** (`goAway`): resumption is configured but has never been tested.

### Phase 1 items built more simply than planned
- [ ] WebGPU renderer with WebGL2 fallback (today: WebGL only, which is fast enough on the M4).
- [ ] Avatar Package format (GLB with ARKit 52 face shapes) and retargeted animation clips (today:
  procedural motion, the built-in character and VRM).
- [ ] Golden tests for lip-sync (fixture audio → expected mouth shapes) and a click-track A/V test.

---

## Phase 2 — Persona Studio

**Done when:** someone who isn't an engineer creates two distinct agents (different name, voice,
avatar and documents) in Studio, and both give grounded, cited answers on the stage.

### Done
- [x] Studio shell: every roadmap feature has a place in the navigation, and planned sections say what's coming.
- [x] Agents with a draft, autosave, Publish, numbered versions and roll back (`services/api/src/store.ts`).
- [x] Starter templates: blank, tutor, customer support, meeting host, game character.
- [x] Profile: name, role, greeting, language.
- [x] Personality: instructions plus four tone sliders that the worker turns into instructions.
- [x] Voice picker with all 30 Gemini voices and samples.
- [x] Appearance: built-in character, VRM upload library, camera framing.
- [x] Google Search grounding toggle, passed to Gemini as a tool (not yet seen working live, see below).
- [x] Audience setting (adults, teenagers, children) and platform rules shown in Studio.
- [x] Live test stage in the editor: talks to the draft and offers a restart after edits.

- [x] Knowledge base: shared document library (PDF, Word, text, Markdown, HTML, web pages, pasted
  text), search by meaning and by words, per-agent document picker, `search_knowledge_base` tool in
  the worker, source names under the captions, and a test console (`services/api/src/knowledge/`).
- [x] Duplicate, delete and search agents from the agents list.
- [x] Memory: opt-in per agent and always off for the children audience; `remember` and `recall`
  tools in the worker; notes kept per agent and visitor (`services/api/src/memory.ts`); the
  visitor's earlier notes are given to the agent when a conversation starts; Studio's Memory panel
  lists and deletes what the agent remembers about you. Tested live: a second conversation
  recalled a name and a hobby from the first.
- [x] Versions can be saved without going live, viewed (with differences from the draft), opened
  for editing, and any version can be made live in one step.
- [x] Gestures and expressions follow the reply as it is spoken (chosen in the browser from the
  streaming captions), questions that need thought get a thinking look, and the thinking face
  now shows on VRM models. Clicking the avatar plays a random gesture.
- [x] Memory page in the main menu listing every saved note by agent and visitor.
- [x] Home page with a walkthrough that ticks itself off; readiness checklist in the Publish
  dialog; Undo instead of "are you sure?" for deleting agents, documents, avatars and notes; a
  transcript under the stage with Copy; portrait thumbnails for avatar models.
- [x] The whole application runs in Docker (`make docker`): LiveKit, API, worker and Studio.
- [x] Studio navigation: back and forward buttons, breadcrumbs, previous and next between an
  agent's panels; the Playground and Avatars pages remember their choices across a refresh.

### Left to do
**Knowledge base, next steps** 💻
- [ ] Move the index from files under `data/knowledge/` to Postgres + pgvector (`make infra-full`
  runs it), together with the agent store. `KnowledgeStore` is the only class to replace.
- [ ] Ingestion as its own service (`services/ingest`) once uploads are large or many; today it
  runs inside the API process.
- [ ] Per-agent test console ("which passages would *this agent* use?"); today it searches the
  whole library.
- [ ] Text recognition for scanned PDFs; re-fetch web pages on a schedule.
- [ ] The worker reaches the API without credentials (fine on one laptop). Add a service token
  when accounts arrive.

**Web search and its citations** 💻
- [x] Worker forwards Gemini's search citations as `agent.sources` events
  (`agent_worker/grounding.py`), shown under the captions like document sources. Unit-tested only.
- [ ] **Web search needs retesting with a fresh key.** On 13 November 2026 every session with
  Google Search switched on was closed by Gemini with "quota exceeded", while sessions without it
  still worked on the same key. The account's quota was running out that day, so it is not known
  whether search has a separate allowance. Test search and its citations live with the new key.

**Memory, next steps** 💻
- [ ] A summary job after each session (today the agent saves notes itself with `remember`).
- [ ] A "forget me" control for visitors on embedded pages (today it is in Studio's Memory panel
  and the `DELETE /memory` route).
- [ ] Move `data/memory.json` to Postgres with the other stores.

**Database** 💻 *(next: the data is still files)*
- [ ] Move agents, memory and the knowledge index from files under `data/` to Postgres + pgvector
  (already defined in `compose.yaml` under the `full` profile, not used yet). Add it to the `app`
  profile once the stores use it, with migrations and a backup command.

**Accounts and teams** 💻
- [ ] Sign-in for Studio, organisations, members and roles (owner, editor, viewer).
- [ ] Move the agent store from `data/agents.json` to Postgres (same `AgentStore` interface).
- [ ] Use agent ids and versions scoped per organisation in the API.

**Custom voices** 💰 *(GPU for good quality; a CPU bake-off is possible)*
- [ ] Bake-off of open-weight text-to-speech models (licence, latency, quality).
- [ ] `services/voice` plus Gemini in text-output mode (half-cascade), with the extra latency shown in Studio.
- [ ] Voice cloning only with a consent recording from the voice's owner.

**Smaller items** 💻
- [ ] Gesture cues know English well and a few everyday words in the other offered languages;
  anything else falls back to punctuation. A small model-chosen cue per sentence would be better.
- [ ] Body language: add a "count" gesture; optionally turn on the `express` tool per agent
  (`AVATAR_EXPRESS_TOOL=1` today, but it costs about 1 s a turn).
- [ ] Duplicate and delete agents from the Studio UI (the API supports both).
- [ ] Agents list: search and filter once there are more than a handful.

---

## Phase 3 — Interaction surface

**Done when:** a customer pastes one snippet on their site and gets a working, tool-using, camera-
and screen-aware avatar restricted to their domain, and the same agent can join a Meet call.

- [ ] **Vision** 💻: camera and screen share → frames to Gemini; the avatar's gaze follows the user's
  face (on-device landmarks, nothing stored).
- [ ] **Tools** 💻: on-screen actions run in the client (cards, quizzes); backend tools with JSON
  schema, signed webhooks, timeouts and confirm-before-act; built-ins `show_card`,
  `handoff_to_human`, `end_session`. Studio pages: Tools, and the agent's Tools panel.
- [ ] **Connectors (MCP)** 💻: MCP client in the worker, sign-in per workspace, allowlist per agent,
  audit log.
- [ ] **Embeddable widget** 💻: `<meta-avatar>` web component and iframe, publishable keys with
  allowed domains, theming, mobile layout, ≤ 150 KB initial script.
- [ ] **Public API and SDKs** 💻: React and JS SDKs, server-side end-user tokens, webhooks
  (`session.ended`, `safety.event`, `handoff.requested`). Studio pages: Embed and API, and the agent's Embed panel.
- [ ] **Meeting bot** 💻/💰: joins Meet, Zoom or Teams and publishes the avatar as its camera
  (the meeting platforms' developer terms need checking).

---

## Phase 4 — Avatar Forge

**Done when:** one front-facing photo (with consent) or one character drawing becomes a usable
avatar in under 10 minutes that passes QA and plays every gesture.

- [ ] **LAM spike first** 💻 (from the first sprint list, still open): build one photoreal head from a
  photo with LAM (Mac, else free Colab) and drive it with our agent's audio in the browser.
  Licence review needed (FLAME is research-only).
- [ ] Upload flow with consent and rights attestation; selfie flow with a liveness check.
- [ ] Safety scan before any processing: CSAM hash matching, minor detection, public-figure checks.
- [ ] `ForgeModel` interface with two paths: person photo → head → body template; character art →
  image-to-3D → auto-rig. Open-weight model bake-off first 💰 (free Colab for experiments).
- [ ] Face-shape transfer, optimisation (LODs, KTX2, meshopt), automated QA renders.
- [ ] Studio: job progress, turntable preview, accept or regenerate (the Avatars page has a spot ready).

---

## Phase 5 — Safety and compliance (gate before any outside user)

**Done when:** the red-team suite meets agreed thresholds, legal sign-off is recorded, and an outside reviewer has checked children's mode.

- [x] Platform rules and audience profiles enforced in the worker.
- [x] AI disclosure badge on the stage.
- [ ] Live moderation of what visitors say and what agents reply: interrupt, redirect, `safety_event` 💻.
- [ ] Strict mode for children (text first, checked before speaking) 💻.
- [ ] Crisis protocol with resources and an escalation webhook 💻.
- [ ] Children's mode locks: no memory, no open search, time limits 💻.
- [ ] Red-team suite in `evals/` run in CI 💻.
- [ ] Compliance: retention settings, export and delete on request, consent records, region pinning 💰.
- [ ] Legal review: Gemini terms for minors (free tier is adults-only), biometric consent, likeness
  rights, recording consent, asset licences 💰.

---

## Phase 6 — Production readiness 💰

- [ ] Quotas, usage metering (minutes per renderer, GPU minutes, Forge jobs) and plan limits;
  payments only to charge customers. Studio pages ready: Usage, Conversations.
- [ ] OpenTelemetry, SLO dashboards, alerts, runbooks.
- [ ] Load tests with synthetic users, soak and chaos tests.
- [ ] Terraform for staging and production (GCP recommended), blue/green worker deploys.
- [ ] Security: SSO, audit logs, secrets in KMS, dependency scanning, pen-test.

---

## Phase 7 — Vertical packs

| Vertical | Next step | First pieces |
|---|---|---|
| Education | Pick as first vertical? | Tutor template exists; LTI 1.3, curriculum import, whiteboard cards, teacher dashboard |
| Customer support | | Support template exists; help-desk connectors, human handoff, satisfaction scores, PII redaction |
| Meetings | Needs the Phase 3 meeting bot | Meeting host template exists; kiosk mode with a wake word |
| Training simulations | | Role-play personas, scoring and a feedback report |
| Gaming | | Game character template exists; Unity and Unreal SDKs on the same protocol |

---

## Neural track — our Neural Avatar Engine

Runs in parallel with the product phases. Only N0 fits the laptop budget.

- [ ] **N0** 💻: eval harness (`ml/eval`: lip-sync accuracy, identity stability, ms per frame), data
  pipeline with consent tracking, and `ml/licenses.yaml` checked in CI.
- [ ] **N1** 💰: lite engine, a talking portrait from one photo, ≥ 25 fps at 512–720p, plugged into
  the `AvatarRenderer` interface (already in `packages/avatar-runtime/src/renderer/`). Small
  experiments can run on free Colab or Kaggle GPUs.
- [ ] **N2** 💰: pro engine distilled from open streaming diffusion weights, ≤ 37 ms per frame at 720p.
- [ ] **N3** 💰: our own foundation model with upper body, hands and emotion control.

---

## Suggested order for the next stretch

1. **Close out:** commit, push, get CI green, finish the voice samples, test with a real mic and a VRM model.
2. ~~**Knowledge base**~~: done on 13 November 2026. Phase 2's "done" test (two agents with
   different documents giving cited answers) can now be run by hand.
3. ~~**Memory**~~: done on 13 November 2026. Web search and its citations still need a live test.
4. **Accounts and the Postgres store:** needed before anyone else uses Studio.
5. **LAM spike:** answers early whether photoreal heads are good enough before Phase 4.
6. **Phase 3 widget and tools:** the first thing a customer would touch.

## Decisions still needed from you

1. **First vertical** to polish: education, support, training, meetings or gaming.
2. **Final product name** ("MetaAvatar" clashes with Meta's brand).
3. **Cloud** when we leave the laptop: GCP with Vertex AI (recommended) or another provider.
4. **Where the $20 goes** if a limit bites: GPU notebooks (for Forge and the neural engine) or paid
   Gemini usage (for demos).
