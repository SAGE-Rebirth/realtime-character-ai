# MetaAvatar Studio — Platform guide

How to use the platform, written for someone opening Studio for the first time. It describes what
works today. Sections marked *planned* show in Studio with the phase they belong to; the
[Roadmap](ROADMAP.md) tracks them.

For installing and starting the platform, see the [README](../README.md). In short: `make start`
(or `make docker` to run everything in containers), then open http://localhost:3100.

---

## 1. The idea in one minute

An **agent** is a character people talk to: it has a name, a personality, a voice, a body (the
**avatar**), and optionally documents it answers from. You build an agent in Studio, talk to it on
the **stage** while you edit, and **publish** it when it is right.

- The **draft** is your working copy. It saves by itself as you type.
- A **published version** is what visitors get. Publishing never happens by accident: you press
  Publish, and each time it creates a numbered version you can go back to.

The stage always shows an "AI" badge, and every agent follows the platform safety rules.

## 2. Finding your way around

| Menu | What it is for |
|---|---|
| **Home** | Where to begin: a walkthrough that ticks itself off as you go |
| **Agents** | Create, open, duplicate and delete agents |
| **Avatars** | The library of bodies. Preview each one and play its gestures |
| **Voices** | Listen to all 30 voices |
| **Knowledge** | Documents agents can answer from, and a console to try questions |
| **Playground** | Talk to any agent with performance readouts; test lip-sync |
| **Tools**, **Embed and API** | *Planned, phase 3* |
| **Conversations**, **Usage** | *Planned, phase 6* |
| **Memory** | Everything agents have saved about visitors, by agent and visitor, with Forget |
| **Safety** | The rules every agent follows, and what each audience setting adds |
| **Settings** | Which AI model and servers this workspace uses |

**Getting around:** the arrows at the top go back and forward through the pages you visited, and
the trail beside them shows where you are (for example *Agents / Ava / Voice*); click any part of
it to go there. Inside an agent, **Previous** and **Next** at the foot of each panel walk through
the settings in order. The Playground and Avatars pages remember your last choices when you
refresh.

## 3. Create your first agent

1. **Agents → New agent.**
2. Choose a starting point: Blank, Tutor, Customer support, Meeting host or Game character.
3. Give it a name (optional; the template has one) and press **Create agent**.

You land in the agent editor. Settings are on the left, the stage is on the right.

## 4. The agent editor, panel by panel

Changes save on their own; the line under the agent's name says "Saving…" then "All changes
saved". Work through the panels in order the first time.

### Profile
- **Name**: what the agent calls itself.
- **Role**: one line on what it is for, such as "Maths tutor for ages 12 to 14". It shapes answers.
- **Greeting**: the first thing it says. Leave it empty to let the visitor speak first.
- **Language**: the language it starts in. It switches if the visitor speaks another one.

### Personality
- **Instructions**: who the agent is and how it should behave, in plain words. Short and specific
  works best: what it helps with, what it should not do, how long answers should be.
- **Four sliders**: warmth, formality, detail and humour. The label beside each slider says what
  the current position means.

### Voice
Press the play button to hear a sample, then **Use** to choose it. Filter by character (Warm,
Firm, Upbeat and so on) at the top. Some samples are not recorded yet; their play button is
greyed out, but the voice still works in conversation.

### Appearance
- **Avatar**: pick the body. Each model shows a small portrait (taken the first time it appears
  on a stage) and its file location; the selected one also shows its
  licence and where it came from. Add your own with *Add a VRM avatar*, or copy a `.vrm` file
  into `assets/avatars/` in the project folder. See the [avatar guide](../assets/avatars/README.md)
  for where to get models.
- **Camera**: Head and shoulders, Waist up, or Full body.
- **Body language**: play each gesture (wave, nod, shrug, explain, point, celebrate, think) and
  expression on the stage to check how the avatar moves. In a real conversation the agent chooses
  these itself from what it is saying.

### Knowledge
- **Documents**: tick the documents this agent may answer from. It looks things up, answers from
  what it finds, names the document, and says so when the answer isn't there. Documents are added
  under **Knowledge** in the main menu (section 6).
- **Web search**: lets the agent search Google for current facts. It uses its own share of the
  Gemini quota.

### Safety
Choose the **audience**: Adults, Teenagers or Children. Younger audiences get stricter rules on
top of the platform rules listed on the same page. The free Gemini tier is for adults only, so
don't put teen or children's agents in front of young people on it.

### Memory
Switch on **Remember returning visitors** and the agent saves short notes about the person it is
talking to (their name, what they are working on) and has them the next time the same visitor
comes back. It never saves passwords, payment or health details.

- **Memory** in the main menu lists every note, for all agents and visitors.
- **What it remembers about you** lists the notes saved while you talked to it in this browser.
  **Forget** removes one; **Forget everything** removes them all.
- Memory is always off for children's agents.
- A visitor is recognised by a random id kept in their browser, not by name. Clearing the
  browser's site data makes them a new visitor.

### Versions
A version is a numbered copy of the agent's settings that never changes once saved. One version
is **Live**: that is what visitors get.

- **Save the draft as a version** keeps the draft as it is now without changing what visitors
  get. Use it for work in progress or a variant to come back to.
- **Publish** (top of the page) saves a version and makes it live in one step.
- **View** shows a version's settings. Anything that differs from your draft is marked, with the
  draft's value beside it.
- **Edit** copies a version into the draft so you can change it. Save or publish the result as a
  new version; the old one stays as it was.
- **Make live** switches what visitors get to that version straight away, without touching the
  draft. This is the quickest way to roll back.
- **Discard draft changes** on the live version throws away everything since it was saved.

### Tools, Embed
*Planned.* Each tab says what is coming.

## 5. Talk to your agent

On the stage press **Talk to (name)**. Allow the microphone when the browser asks.

- Speak normally. You can talk over the agent and it stops to listen.
- **Type a message** works too, and is the fallback if the microphone is blocked.
- **Mute** stops your microphone; **End** ends the conversation.
- Captions show what was said. When the agent answers from a document or the web, a **From** line
  under the captions names the source.
- If you change a setting during a conversation, a bar offers **Restart** so you hear the change.
- The avatar's **body language follows the conversation**: it waves on a greeting, looks
  thoughtful when you ask something that needs thought, nods, explains with its hands, and its
  face shows happy, sorry or surprised moments in what it says.
- **Click the avatar** at any time and it reacts with a random gesture.
- **Transcript** (under the stage once something has been said) shows the whole conversation and
  stays after you end it. **Copy** puts it on the clipboard.

In the editor you are always talking to the **draft**.

## 6. Give an agent documents

1. **Knowledge** (main menu) → add a file (PDF, Word, text, Markdown, HTML; up to 20 MB), a web
   page address, or paste text.
2. Wait for the status to turn **Ready**. "Word matching only" means the document works, but the
   agent finds passages by shared words rather than by meaning; press **Try again** later.
3. **Try a question** on the right shows which passages a question brings back. If the right
   passage isn't the best match, the document probably doesn't say it clearly enough.
4. Open the agent → **Knowledge** and tick the documents it should use.

Scanned PDFs (pictures of pages) contain no text and are refused with a message.

## 7. Publish

Press **Publish** at the top of the editor. A short checklist shows what is in place and what is
worth a look first (no instructions, a missing avatar file, documents not ready, or a draft you
haven't talked to since the last change), each with a link to fix it. Nothing on it stops you
publishing. Optionally describe what changed, and confirm. The
tag under the name changes to "Live v1" (then v2, v3…). After that:

- "Draft differs from live" appears whenever the draft has changes visitors don't have yet.
- Publish again to release them, or discard them under **Versions**.

## 8. The Playground

A test bench for any agent.

- **Agent** and **Version**: choose the agent, and whether to talk to the live version or the
  draft. They can look and sound different if the draft has unpublished changes.
- **Camera** and **Sound**: Speakers is the default; Headphones delays sound by a few
  milliseconds so lips and voice line up exactly.
- **Performance**: frame rate, lips-versus-sound offset, reply time, connection.
- **Body language**: the same gesture and expression buttons as in Appearance.
- **Lip-sync test**: the avatar mouths whatever your microphone hears. No AI is involved, so it
  works without a Gemini key.

## 9. Managing agents

On the **Agents** page, **More** on each row offers:

- **Duplicate**: a copy to experiment on.
- **Delete**: removes the agent and all its versions.

**Undo:** deleting an agent, a document, an avatar or a remembered note takes effect at once on
screen, and a bar at the bottom offers **Undo** for seven seconds. After that it is gone for good.

A search box appears once there are more than five agents.

## 10. When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| "Can't reach the API…" | The platform isn't running | `make start`, then `make status` |
| "The agent didn't join." | The agent worker isn't running | `make status`; `make restart s=worker` |
| "The AI service is out of quota right now." | The Gemini key's allowance is used up | Wait for it to refresh, or use another key in `.env` and `make restart` |
| "…out of quota for web search…" | The quota doesn't cover web search at the moment | Switch off *Search the web* in the agent's Knowledge tab |
| "The microphone is blocked for this page." | The browser refused the microphone | Allow it in the browser's site settings, or type instead |
| "Too many requests in a short time." | More than 30 conversations were started in a minute | Wait a minute |
| "This agent was changed somewhere else…" | Another tab or person saved a newer version | Press **Reload**; your last edit in this tab wasn't saved |
| "This avatar file couldn't be loaded…" | The model file was removed or is broken | Pick another avatar under Appearance, or put the file back |
| "No published version yet" | The Playground is set to the live version of an unpublished agent | Switch Version to Draft, or publish |
| A voice's play button is greyed out | Its sample isn't recorded yet | `make voices` records the missing ones |

Logs for each part are in `.run/` (`make logs`, or `make logs s=worker`).

## 11. Where things are kept

| What | Where |
|---|---|
| Agents and their versions | `data/agents.json` |
| Knowledge documents and their search index | `data/knowledge/` |
| What agents remember about visitors | `data/memory.json` |
| Avatar models | `assets/avatars/` (each with an optional `.json` of name, source, licence) |
| Voice samples | `apps/studio/public/voices/` |
| Keys and settings | `.env` (never committed) |

Back up `data/` and `assets/avatars/` to keep your work. If `agents.json` ever can't be read, the
platform keeps a copy named `agents.json.unreadable-…` instead of overwriting it.

## 12. Limits today

- One workspace, no sign-in: anyone who can open Studio can edit everything.
- Agents can't yet call tools or be embedded on a website.
- Body language is chosen from the words of the reply. It knows English best; other languages get
  greetings, thanks, apologies and punctuation-based reactions.
- Avatars are 3D models rendered in the visitor's browser; photoreal avatars from a photo are
  planned.
- Running on the free Gemini tier means daily limits and adults-only use.
