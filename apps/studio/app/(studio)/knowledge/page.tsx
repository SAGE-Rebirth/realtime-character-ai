"use client";

/**
 * Knowledge: the shared library of documents agents answer from, plus a test console that shows
 * which passages a question would bring back before any agent uses them.
 */
import type { KnowledgeDoc, KnowledgeSearchResponse } from "@metaavatar/protocol";
import { useEffect, useState } from "react";
import { btn, Notice, PageHeader, Section, Tag, ui } from "@/components/ui";
import { api, timeAgo } from "@/lib/api";
import { describeDoc, useKnowledge } from "@/lib/knowledge";
import s from "./knowledge.module.css";

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.json";

function AddDocuments({ onAdded }: { onAdded: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState("");
  const [pasting, setPasting] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await work();
      onAdded();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const upload = (files: FileList | null | undefined) =>
    files?.length &&
    run(async () => {
      // One at a time, so a refused file names itself and the rest still go through.
      for (const f of Array.from(files)) await api.uploadDocument(f);
    });

  return (
    <div className={s.add}>
      <label
        className={s.drop}
        data-over={over}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          className={s.fileInput}
          accept={ACCEPT}
          multiple
          disabled={busy}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
        <span className={s.dropTitle}>{busy ? "Adding…" : "Add files"}</span>
        <span className={s.dropHelp}>Drop files here or choose them. PDF, Word, text, Markdown or HTML, up to 20 MB each.</span>
      </label>

      <form
        className={s.inline}
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api.addDocumentUrl(url.trim())).then((ok) => ok && setUrl(""));
        }}
      >
        <input
          className={ui.input}
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/help/returns"
          aria-label="Web page address"
        />
        <button className={btn()} disabled={busy || !url.trim()}>
          Add web page
        </button>
      </form>

      {pasting ? (
        <form
          className={s.paste}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.addDocumentText(title.trim(), text)).then((ok) => {
              if (!ok) return;
              setTitle("");
              setText("");
              setPasting(false);
            });
          }}
        >
          <input
            className={ui.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title, for example: Opening hours"
            aria-label="Title"
            maxLength={120}
            autoFocus
          />
          <textarea
            className={ui.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the text the agent should know"
            aria-label="Text"
          />
          <div className={s.pasteActions}>
            <button type="button" className={btn("quiet")} onClick={() => setPasting(false)}>
              Cancel
            </button>
            <button className={btn("primary")} disabled={busy || !title.trim() || !text.trim()}>
              Add text
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button className={btn("quiet")} onClick={() => setPasting(true)}>
            Paste text instead
          </button>
        </div>
      )}
      {error && <Notice error>{error}</Notice>}
    </div>
  );
}

function DocRow({ doc, onChange }: { doc: KnowledgeDoc; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    await work().catch(() => undefined);
    setBusy(false);
    onChange();
  };
  return (
    <li className={s.doc}>
      <span className={s.docTitle}>{doc.title}</span>
      <span className={s.docMeta}>
        {describeDoc(doc)} · added {timeAgo(doc.addedAt)}
      </span>
      <span className={s.docStatus}>
        {doc.status === "processing" && (
          <Tag>
            <span className={s.spinner} aria-hidden /> Reading
          </Tag>
        )}
        {doc.status === "failed" && <Tag tone="warn">Couldn't read</Tag>}
        {doc.status === "ready" && !doc.embedded && (
          <span title="The agent finds passages that share words with the question, but not ones that only mean the same.">
            <Tag tone="warn">Word matching only</Tag>
          </span>
        )}
        {doc.status === "ready" && doc.embedded && <Tag tone="live">Ready</Tag>}
      </span>
      <span className={s.docActions}>
        {doc.status === "ready" && !doc.embedded && (
          <button className={btn("quiet", true)} disabled={busy} onClick={() => void act(() => api.embedDocument(doc.id))}>
            {busy ? "Trying…" : "Try again"}
          </button>
        )}
        <button
          className={btn("quiet", true)}
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Remove "${doc.title}"? Agents that use it will stop answering from it.`)) {
              void act(() => api.deleteDocument(doc.id));
            }
          }}
        >
          Remove
        </button>
      </span>
      {doc.status === "failed" && doc.error && <span className={s.docError}>{doc.error}</span>}
    </li>
  );
}

function TestConsole({ ready }: { ready: number }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KnowledgeSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api.searchKnowledge(query.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Try a question"
      help="See the passages an agent would be given for a question, most relevant first. Searches the whole library."
    >
      <form className={s.inline} onSubmit={ask}>
        <input
          className={ui.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="For example: how long do refunds take?"
          aria-label="Question"
          maxLength={1000}
        />
        <button className={btn("primary")} disabled={busy || !query.trim() || ready === 0}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      {ready === 0 && <p className={ui.help}>Add a document first.</p>}
      {error && <Notice error>{error}</Notice>}
      {result && result.passages.length === 0 && (
        <Notice>
          Nothing in the library matches that. An agent asked this would say it doesn't have the information.
        </Notice>
      )}
      {result && result.passages.length > 0 && (
        <>
          <ol className={s.passages}>
            {result.passages.map((p, i) => (
              <li key={`${p.documentId}-${p.chunk}`} className={s.passage}>
                <div className={s.passageHead}>
                  <span className={s.passageTitle}>{p.title}</span>
                  <span className={s.rank}>
                    {i === 0 ? "Best match" : `Match ${i + 1}`}
                  </span>
                </div>
                <p className={s.passageText}>{p.text}</p>
              </li>
            ))}
          </ol>
          {result.mode === "words" && (
            <p className={ui.help}>Matched on shared words only. Matching on meaning needs the Gemini key and quota.</p>
          )}
        </>
      )}
    </Section>
  );
}

export default function KnowledgePage() {
  const { docs, error, refresh } = useKnowledge();
  useEffect(() => {
    document.title = "Knowledge · MetaAvatar Studio";
  }, []);
  const ready = docs?.filter((d) => d.status === "ready").length ?? 0;

  return (
    <div className={s.page}>
      <PageHeader
        title="Knowledge"
        lead="Documents your agents can answer from: manuals, FAQs, policies, lesson notes. Add a document once, then give it to any agent under its Knowledge settings."
      />
      <div className={s.grid}>
        <div className={s.side}>
          <Section title="Add documents">
            <AddDocuments onAdded={() => void refresh()} />
          </Section>
          <Section title="Library">
            {error && <Notice error>{error}</Notice>}
            {!docs && !error && <p className={ui.help}>Loading documents…</p>}
            {docs && docs.length === 0 && <p className={s.empty}>No documents yet. Add a file, a web page or some text above.</p>}
            {docs && docs.length > 0 && (
              <ul className={s.list}>
                {docs.map((d) => (
                  <DocRow key={d.id} doc={d} onChange={() => void refresh()} />
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className={s.console}>
          <TestConsole ready={ready} />
        </div>
      </div>
    </div>
  );
}
