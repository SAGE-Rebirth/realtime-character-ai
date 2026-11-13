import { describe, expect, it } from "vitest";
import { CuePlanner, cueForSentence } from "./cues";

describe("cueForSentence", () => {
  it("reads the meaning of a sentence", () => {
    expect(cueForSentence("Hello there, nice to see you!")).toMatchObject({ gesture: "wave", emotion: "happy" });
    expect(cueForSentence("Hmm, let me think about that.")).toMatchObject({ gesture: "think", emotion: "thinking" });
    expect(cueForSentence("I'm not sure, it depends.")).toMatchObject({ gesture: "shrug" });
    expect(cueForSentence("Unfortunately the shop is closed.")).toMatchObject({ emotion: "sad" });
    expect(cueForSentence("First, mix the flour.")).toMatchObject({ gesture: "explain" });
    expect(cueForSentence("The sky is blue.")).toBeNull();
  });

  it("covers everyday words in other languages, and falls back to punctuation", () => {
    expect(cueForSentence("नमस्ते! मैं एवा हूँ।")).toMatchObject({ gesture: "wave", emotion: "happy" });
    expect(cueForSentence("Lo siento, está cerrado.")).toMatchObject({ emotion: "sad" });
    expect(cueForSentence("Parce que la levure produit du gaz.")).toMatchObject({ gesture: "explain" });
    expect(cueForSentence("आज आप किस बारे में बात करना चाहेंगे?")).toMatchObject({ gesture: "explain" });
    expect(cueForSentence("Das ist toll!")).toMatchObject({ emotion: "happy" });
  });
});

describe("CuePlanner", () => {
  it("cues each sentence once as a reply streams in", () => {
    const p = new CuePlanner(0);
    expect(p.onAgentText("a", "Hello the", false, 0)).toEqual([]);
    expect(p.onAgentText("a", "Hello there! Let me th", false, 0.2)).toMatchObject([{ gesture: "wave" }]);
    expect(p.onAgentText("a", "Hello there! Let me think. The answer", false, 1)).toMatchObject([{ gesture: "think" }]);
    // The last sentence has no full stop yet; the final caption completes it.
    expect(p.onAgentText("a", "Hello there! Let me think. The answer is yes", true, 2)).toMatchObject([{ gesture: "nod" }]);
    // Hindi sentences end with a danda, not a full stop.
    expect(p.onAgentText("h", "नमस्ते। मैं एवा हूँ।", true, 9)).toMatchObject([{ gesture: "wave" }]);
  });

  it("spaces gestures out but still shows expressions", () => {
    const p = new CuePlanner(2);
    const cues = p.onAgentText("a", "Hello! Congratulations, well done! Sorry about the wait.", true, 0);
    expect(cues).toEqual([{ gesture: "wave", emotion: "happy" }, { emotion: "happy" }, { emotion: "sad" }]);
    expect(p.onAgentText("b", "Well done!", true, 3)).toMatchObject([{ gesture: "celebrate" }]);
  });

  it("looks thoughtful for questions that need thought, not for small talk", () => {
    const p = new CuePlanner();
    expect(p.onUserText("Why is the sky blue?", 0)).toMatchObject({ gesture: "think", emotion: "thinking" });
    expect(p.onUserText("Explain how photosynthesis works", 5)).toMatchObject({ emotion: "thinking" });
    expect(p.onUserText("Is it sunny?", 10)).toBeNull();
    expect(p.onUserText("Thanks, that's all.", 15)).toBeNull();
  });
});
