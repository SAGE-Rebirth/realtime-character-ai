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
| 2 | Persona Studio: agents as configuration | **Mostly done**: knowledge base built; memory, accounts and custom voices left |
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

### Verification not done yet
- [ ] **Knowledge base with real documents**: tested with a short PDF, a Word file and one web page.
  Try a long manual (100+ pages), a scanned PDF (expected to be refused with a clear message) and
  questions in another language, and check the `KNOWLEDGE_MIN_SIMILARITY` level (0.58, measured on
  a small sample) still separates related from unrelated passages.
- [ ] **Spoken questions to a knowledge agent**: the document lookup was tested with typed
  questions only.
- [ ] **Test with a real microphone** in Chrome and Safari: start a conversation, talk over the
  avatar, mute and unmute. Every voice test so far used a scripted voice or typed messages.
- [ ] **Load a real VRM model**: upload one under Avatars, assign it to an agent, and check the lip-sync,
  blinks and gestures. Only the built-in character has been tested. A free CC0 or VRoid model is
  needed (pick one with a licence that allows commercial use).
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
- [x] Google Search grounding toggle, passed to Gemini as a tool.
- [x] Audience setting (adults, teenagers, children) and platform rules shown in Studio.
- [x] Live test stage in the editor: talks to the draft and offers a restart after edits.

- [x] Knowledge base: shared document library (PDF, Word, text, Markdown, HTML, web pages, pasted
  text), search by meaning and by words, per-agent document picker, `search_knowledge_base` tool in
  the worker, source names under the captions, and a test console (`services/api/src/knowledge/`).
- [x] Duplicate, delete and search agents from the agents list.

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

**Citations for web search** 💻
- [ ] Pass Gemini's grounding metadata through the data channel as `agent.sources` events (the
  event and the caption display already exist for documents).

**Memory** 💻
- [ ] Opt-in per agent (forced off for the children audience).
- [ ] `remember` / `recall` tools, a summary job after each session, and "forget me" for visitors.

**Accounts and teams** 💻
- [ ] Sign-in for Studio, organisations, members and roles (owner, editor, viewer).
- [ ] Move the agent store from `data/agents.json` to Postgres (same `AgentStore` interface).
- [ ] Use agent ids and versions scoped per organisation in the API.

**Custom voices** 💰 *(GPU for good quality; a CPU bake-off is possible)*
- [ ] Bake-off of open-weight text-to-speech models (licence, latency, quality).
- [ ] `services/voice` plus Gemini in text-output mode (half-cascade), with the extra latency shown in Studio.
- [ ] Voice cloning only with a consent recording from the voice's owner.

**Smaller items** 💻
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
3. **Web search citations and memory:** both small now that sources and the search tool exist.
4. **Accounts and the Postgres store:** needed before anyone else uses Studio.
5. **LAM spike:** answers early whether photoreal heads are good enough before Phase 4.
6. **Phase 3 widget and tools:** the first thing a customer would touch.

## Decisions still needed from you

1. **First vertical** to polish: education, support, training, meetings or gaming.
2. **Final product name** ("MetaAvatar" clashes with Meta's brand).
3. **Cloud** when we leave the laptop: GCP with Vertex AI (recommended) or another provider.
4. **Where the $20 goes** if a limit bites: GPU notebooks (for Forge and the neural engine) or paid
   Gemini usage (for demos).
