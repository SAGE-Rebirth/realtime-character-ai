# CLAUDE.md — working instructions for this repository

You are continuing a project that was built carefully. Your job is to keep it that way. Read this
file fully before touching anything, then read the three documents under "Read first".

## The project in one paragraph

MetaAvatar is a platform for real-time talking characters ("agents"): a person speaks, Gemini Live
answers with a voice, and a 3D avatar in the browser lip-syncs, gestures and shows expressions.
Studio (a web app) is where agents are created, tested and published. It must run on one laptop
with free tiers: no paid services, at most $20 a month.

## Read first

1. `docs/ROADMAP.md`: what is done, what is next, and what was decided. The single source of truth
   for status. Update it in the same change as the work.
2. `docs/ARCHITECTURE.md`: how the pieces fit and why.
3. `docs/IMPLEMENTATION_GUIDE.md`: how each part is built, and lessons already paid for.

`docs/PLATFORM_GUIDE.md` is the user manual; update it when anything a user sees changes.

## Rules from the owner (do not break these)

- **Build only what was asked.** "Keep building the features when I say so, then we do the testing."
  Do not start the next roadmap item on your own; finish, verify, report, and ask.
- **Avatar models live in `assets/avatars/` and are never deleted.** Not to tidy up, not to replace.
  Keep the source links in `assets/avatars/README.md`.
- **The owner commits and pushes.** Never commit, push, or open a pull request unless asked.
- **No paid platforms.** Laptop and free tiers only.
- **Live tests that use the Gemini key wait for the owner's go-ahead.** Free-tier quota runs out;
  an out-of-quota error is not a bug in the code.
- **Never print, log or commit secrets** (`.env`, `data/`).
- **Test accounts are temporary.** For a browser check, add a throwaway member and remove it (and
  every agent, tool, key and webhook you made) before you finish. Never touch the owner's account.

## Layout

| Path | What it is |
|---|---|
| `apps/studio` | Studio, Next.js 16 + React 19. **Read `apps/studio/AGENTS.md` first: this Next.js has breaking changes; check `node_modules/next/dist/docs/` before using an API from memory.** |
| `services/api` | Platform API, Hono on Node, run with `tsx`. Routes in `src/app.ts`; stores in `src/store.ts`, `src/accounts.ts`, `src/memory.ts`, `src/knowledge/`, `src/integrations.ts`, `src/forge.ts`; `src/db.ts` and `src/boot.ts` connect them to Postgres. |
| `services/agent-worker` | Python worker (uv, LiveKit Agents + Gemini Live). One job per conversation. |
| `packages/protocol` | Zod schemas shared by everything. The Python models are generated from it. |
| `packages/avatar-runtime` | Browser runtime: three.js, VRM, lip-sync, gestures, LiveKit client. |
| `packages/sdk` | For customers' own apps: browser client, React component, server helpers. |
| `infra/docker` | Dockerfiles and `compose.yaml`. |
| `scripts/run.sh`, `Makefile` | Start, stop, check. Run `make` to list commands. |
| `assets/avatars` | VRM models and their notes. |
| `data/` | Local data (git-ignored). |
| `evals/` | Voice latency and barge-in measurement (`make eval`). |

## Commands

```bash
make start      # LiveKit and Postgres in Docker; API, worker and Studio as local processes
make stop
make restart s=worker   # the worker does not reload on file changes; the API and Studio do
make check      # typecheck + lint + all tests. Must pass before you say anything is done.
make protocol   # after ANY change in packages/protocol: rebuild and regenerate the Python models
make docker     # the whole stack in containers (run `make stop` first: same ports)
make eval       # live voice measurement; uses Gemini quota, ask first
```

Studio is at http://localhost:3100, the API at http://localhost:8787.

## How to work here (the method that produced this code)

1. **Read before you write.** Open the file and its neighbours, find how the same thing is already
   done, and follow that. Do not introduce a second way of doing something.
2. **Change the schema first.** A new field goes into `packages/protocol/src/index.ts`, then
   `make protocol`, then the API, then the worker, then Studio. Never hand-edit
   `services/agent-worker/agent_worker/protocol_models.py`: it is generated.
3. **New schema fields need defaults** (`.default(...)`), so saved agents and old versions still
   load. `AgentStore` re-reads everything through the schema on load.
4. **Every API change gets a test** in `services/api/src/*.test.ts` (in-memory stores, no network).
   Worker logic gets a test in `services/agent-worker/tests/`. Tests never call Gemini or LiveKit.
5. **Verify in the real app, not only in tests.** After a Studio change, open the page in the
   browser, click through the flow, and read the console for errors. Report what you actually
   saw. If you could not check something, say so plainly; never write "should work".
6. **Measure before tuning.** Thresholds in the code (search similarity, turn silence, gesture
   timing) were set from measurements. Do not change one without measuring again.
7. **Small, complete steps.** Finish one thing end to end (schema, API, worker, Studio, tests,
   docs) before starting the next. No half-wired features, no TODOs left in code.
8. **Run `make check` at the end of every piece of work** and fix what it finds.
9. **Update the docs in the same change**: ROADMAP (status), PLATFORM_GUIDE (anything user-visible),
   README (commands, API table), `.env.example` (new settings).

## Code conventions

- TypeScript is strict. No `any`, no `@ts-ignore`. The API uses relative imports without extensions.
- Comments explain **why**, in plain words. No comments that restate the code.
- Error codes from the API are short snake_case strings (`not_found`, `conflict`). Every code a user
  can hit has a plain-language message in `describe()` in `apps/studio/lib/api.ts`. Add yours.
- Studio wording is for non-technical people: say what happened and what to do next. No jargon.
- Studio styling is CSS modules with the variables in `app/globals.css`. No UI library, no Tailwind.
- Destructive actions use `useUndo()` from `components/Undo.tsx` (delayed commit), not a confirm box.
- View state that should survive a reload uses `usePersisted` (`lib/usePersisted.ts`).
- Python: ruff decides formatting (`make fmt`). Type hints everywhere. Tool functions return a
  sentence the model can act on, including when something failed.
- Stores (`AgentStore`, `MemoryStore`, `KnowledgeStore`, `AccountStore`, `IntegrationsStore`, `ForgeStore`) are the only code that
  touches saved data. Routes call store methods; they never read files or SQL themselves.

## Things that have already gone wrong (do not repeat them)

- **Gemini Live answers on `v1alpha`** for this key type; `v1beta` returns 404.
- **The `express` tool costs a full extra model round trip** per reply, so it is off by default.
  Gestures and expressions are chosen in the browser from the captions as they stream
  (`packages/avatar-runtime/src/animation/cues.ts`). Do not move this back to the worker: cues
  chosen from the finished reply arrive after the speech has ended.
- **Non-blocking tools made the model stay silent.** Keep the default blocking tool behaviour.
- **VRM 0.x models need their arm rotations flipped** (`avatar/vrm.ts`, `flip`). VRM models have no
  "thinking" expression; it is emulated.
- **`HTTPS_PROXY` breaks the worker's LiveKit connection** on localhost; `livekit_proxy()` handles it.
- **Reading whole avatar files into memory made the API's memory balloon.** They are streamed.
- **asyncio drops tasks nobody holds**; the worker keeps them in a set (`fire()` in `main.py`).
- **Search without a similarity floor returns filler.** Keep the floor, the margin and the word
  coverage rule in `knowledge/store.ts`.
- **A stale browser tab used to overwrite newer edits.** Draft saves send `x-based-on`; the API
  answers 409 and Studio offers Reload. Keep sending it.
- **Barge-in** is detected from the speech handle's `interrupted` flag, not from LiveKit's user state.
- **Zod `.min(1)` on array items** makes the Python generator emit an awkward wrapper type. Avoid it.
- **In Docker the worker shares LiveKit's network** (`network_mode: service:livekit`) because LiveKit
  tells peers to send media to 127.0.0.1. Do not "simplify" this.
- **Vision silently did nothing** until `livekit-agents[images]` was installed: frames failed to
  encode in a background task and the model answered "the picture is black". When adding a worker
  capability, read `.run/worker.log` for errors after a live test, not only the conversation.
- **Two extra buttons squeezed the stage's message box to 5 pixels** and a click meant for it hit
  End. After changing a row of controls, measure it in the browser at panel width.
- **`mcp` 2.x renamed `FastMCP`** (now `mcp.server.mcpserver.MCPServer`) and LiveKit deprecated
  `Agent(mcp_servers=...)`; connectors are attached as `mcp.MCPToolset`. Check the installed
  library before using an API from memory.
- **The model asked for permission out loud as well as on screen** until the tool description said
  not to. Wording in tool descriptions changes behaviour; test it live.
- **zsh does not split a command held in a variable**: scripts that build commands need bash arrays
  (`bash -c '...'`, `C=(docker compose -f ...)`, `"${C[@]}"`).
- **Deleting rows straight from Postgres needs an API restart**: the stores read the tables once.
- **`img.decode()` never settles while the tab is in the background**; decode files with
  `createImageBitmap` (Forge upload).
- **`gemini-flash-latest` hung for over a minute** on a picture; `gemini-flash-lite-latest` answers in
  about two seconds. Before choosing a Gemini model, time it with the project's key; a 404 means the
  name is wrong for this key.
- **Pictures of faces must never be committed**: `assets/avatars/*.portrait.*` is git-ignored. Keep it.
- **Python string splicing broke a file**: replacing "from the first `main()`" hit the vertex
  shader's `main` and duplicated the fragment shader; the dev server failed while `tsc` alone looked
  fine at first. After scripted edits, run `tsc` and load the page.
- **Pressing End mid-sentence threw an uncaught error** from the caption stream; the loop in
  `session.ts` now catches it. Any `for await` over a LiveKit stream needs a try/catch.

## Testing playbook (how the last features were verified; repeat it)

Unit tests are necessary and not enough: most bugs found so far only showed up in the running app.
For any user-visible change, do all of this.

1. **Start the local stack** with `make start` (if `make docker` is running, `make docker-stop`
   first). `make status` shows what is up. After the laptop restarts, everything is down, the
   scratchpad folder is empty and the test browser has lost its sign-in.
2. **Use a throwaway account, never the owner's.** Create a member with a temporary script under
   `services/api/` (delete it afterwards):
   ```ts
   // services/api/qa-user.mts. Run: npx tsx qa-user.mts   (or: npx tsx qa-user.mts remove)
   import { AccountStore } from "./src/accounts";
   import { PostgresDatabase } from "./src/db";
   import { OWNER } from "./src/testing";
   const db = await PostgresDatabase.open("postgres://metaavatar:metaavatar@localhost:5433/metaavatar", 3);
   const accounts = new AccountStore(null);
   await accounts.attach(db, false);
   const existing = accounts.users().find((u) => u.email === "qa-temp@example.com");
   if (process.argv[2] === "remove") { if (existing) accounts.removeUser(existing.id); }
   else if (!existing) await accounts.createUser("qa-temp@example.com", "QA Check", OWNER.password, "member");
   await db.settled();
   await db.close();
   ```
   Then `make restart s=api` (stores read the tables once) and sign in as `qa-temp@example.com`
   with the password in `services/api/src/testing.ts`.
3. **Make test data through the API or Studio, as that member**, with names that say what they are
   ("Forge QA", "Phase3 QA"). Never edit the owner's agents; create your own.
4. **Drive the real flow in the browser** and read the console for errors after each step. Then
   look at the result: take screenshots, and for avatar work capture the canvas
   (`canvas.toDataURL()`) and view it. Several bugs were only visible in a picture.
5. **For live conversations** (they use Gemini quota; the owner has asked for features to be fully
   tested), start one from the stage, type messages, and read `.run/worker.log` afterwards for
   warnings and errors. "received server content but no active generation" is a known harmless
   warning.
6. **Check phone width** (375 px): no sideways scrolling, controls not squeezed.
7. **Clean up**: delete your agents, tools, connectors, embed keys and any avatar files you made
   through the API; remove test rows you can't reach through the API (then `make restart s=api`);
   remove the member; delete the temporary script; stop helper processes.
8. **Run `make check`**, and for API storage changes also
   `TEST_DATABASE_URL=postgres://metaavatar:metaavatar@localhost:5433/metaavatar pnpm --filter @metaavatar/api test`.
9. **Rebuild Docker** (`make stop && make docker`) and check the containers are healthy, protected
   routes answer 401 signed out, and new dependencies are in the images.

**Limits of the test browser:** it blocks the microphone, the camera and screen capture, and runs
animation frames only about once a second, so motion can't be judged there. Test those by other
means (a synthetic video feed with `livekit.rtc`, rendering single frames on purpose) and say
plainly what you could not check.

## Before you say "done"

- [ ] `make check` passes.
- [ ] You used the feature in the browser (or said exactly what you could not check).
- [ ] No new console errors in Studio; no new warnings in `.run/api.log` or `.run/worker.log`.
- [ ] ROADMAP, PLATFORM_GUIDE, README and `.env.example` match the code.
- [ ] Nothing in `assets/avatars` was removed. Nothing was committed.
- [ ] Your report says what changed, what was verified and how, and what is still open.

## Status

See `docs/ROADMAP.md` for the full picture. The section below is kept current by whoever worked last.

<!-- STATUS:START -->
Last updated 17 November 2026. `make check` passes: 53 API tests (plus 2 against real Postgres),
22 runtime, 5 SDK, 3 protocol, 20 worker. Nothing is committed: the owner commits.

**Built and verified:**

- Phases 0 to 2: core loop, Studio, knowledge base, memory, versions, Docker, accounts and sign-in,
  API protection, Postgres.
- Phase 3, all but the meeting bot: tools, connectors (MCP), on-screen permission, built-in actions,
  vision, embeds and widget, webhooks, visitor tokens, SDK.
- **Phase 4, portrait path (Avatar Forge)**, verified end to end in the browser and with a live
  conversation (see "Phase 4" in `docs/ROADMAP.md`):
  - Protocol: `PortraitRig`, `checkPortraitRig`, `AvatarRef` kind `portrait`, Forge job types.
  - Runtime: `avatar/portrait.ts` (shader), `ThreeRenderer.selfCheck()`, `previewSpeech()`.
  - API: `forge.ts` (`ForgeStore`, `GeminiScanner`, `judge`, `readPicture`), `/forge` routes in
    `app.ts`, portraits in the avatar library and on signed embed links.
  - Studio: `app/(studio)/forge/`, portraits in `AvatarPicker`.
  - Settings: `FORGE_SCAN=off`, `FORGE_SCAN_MODEL` (see `.env.example`).

**How the main pieces connect, for orientation:**

- An avatar is an `AvatarRef` (`vrm`, `procedural` or `portrait`). Each kind is an `AvatarModel` in
  `packages/avatar-runtime/src/avatar/`; `ThreeRenderer.setAvatar` picks the class. A new kind of
  avatar goes there and nowhere else above it.
- Who may call a route is decided in one place: "Who is asking" in `services/api/src/app.ts`
  (`isPublic`, `serviceMay`, `ownerOnly`). New routes are protected by default.
- The worker never holds secrets or outside addresses: tool calls, hand-offs and session settings
  go through `/internal/*` with the service token.

**Open, in this order (do not start any without the owner asking):**

1. Check camera and screen sharing, and the Forge's face finder, by hand in Chrome (the test
   browser blocks capture and has no face detector).
2. Web search and its citations need a live test with a key that has quota.
3. Phase 5 safety work before any outside user, including CSAM hash matching for the Forge.
4. Phase 4's 3D path (a GPU budget and a model bake-off first), the LAM spike, the meeting bot.

**Known gaps:** no password reset by email; sign-in rate limit is in memory; one API process per
database; embed "allowed websites" is enforced through the browser; portraits are head and
shoulders only and turn only a little; the Forge's public-figure check is a confirmation, not a check.
<!-- STATUS:END -->
