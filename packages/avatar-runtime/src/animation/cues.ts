/**
 * Picks gestures and expressions from what is being said, as it is said.
 *
 * The runtime feeds this the agent's captions while they stream (so a wave lands on "hello", not
 * after the sentence is over) and the user's finished questions (so the avatar looks thoughtful
 * while a hard question is being answered). Pure logic, no DOM, so it is unit-tested.
 */
import type { Emotion, Gesture } from "@metaavatar/protocol";

export interface Cue {
  gesture?: Gesture;
  emotion?: Emotion;
  /** Seconds the expression is held before easing back to neutral. */
  hold?: number;
}

interface Rule extends Cue {
  pattern: RegExp;
}

/** First match wins, so more specific meanings come before general ones. */
const AGENT_RULES: Rule[] = [
  { pattern: /\b(hi|hello|hey|welcome|good (morning|afternoon|evening)|nice to meet)\b/, gesture: "wave", emotion: "happy" },
  { pattern: /\b(bye|goodbye|see you|take care|talk soon)\b/, gesture: "wave", emotion: "happy" },
  { pattern: /\b(congrat\w*|well done|great job|you did it|you got it|nailed it|hooray|yay)\b/, gesture: "celebrate", emotion: "happy" },
  { pattern: /\b(hmm+|let me think|let's think|let me see|good question|great question|interesting question|i wonder|that's a tricky|tough one|thinking about)\b/, gesture: "think", emotion: "thinking", hold: 3 },
  { pattern: /\b(i'?m not sure|i don'?t know|not certain|hard to say|it depends|who knows|i can'?t tell)\b/, gesture: "shrug", emotion: "thinking" },
  { pattern: /\b(sorry|apolog\w+|unfortunately|sadly|i'?m afraid|that'?s a shame|sorry to hear)\b/, emotion: "sad" },
  { pattern: /\b(wow|whoa|really\?|no way|incredible|unbelievable|surpris\w*|oh my)\b/, emotion: "surprised", gesture: "nod" },
  { pattern: /\b(awesome|amazing|fantastic|wonderful|brilliant|love (it|that)|glad|happy to|great to|excellent|perfect)\b/, emotion: "happy", gesture: "nod" },
  { pattern: /\b(look at|over there|this one|right here|on the (left|right)|take a look|as you can see)\b/, gesture: "point" },
  { pattern: /\b(first(ly)?|second(ly)?|third(ly)?|step \w+|next,|then,|finally|because|for example|for instance|the reason|in other words|which means|imagine|think of it)\b/, gesture: "explain" },
  { pattern: /\b(yes|yeah|yep|exactly|right|correct|absolutely|sure|of course|definitely|that'?s it)\b/, gesture: "nod" },
  { pattern: /\b(no|nope|not really|not quite|i'?m afraid not|incorrect)\b/, gesture: "shake_head" },
  { pattern: /\b(relax|no worries|don'?t worry|take your time|no rush|it'?s okay|that'?s fine)\b/, emotion: "relaxed" },
];

/**
 * A few everyday words in the other languages Studio offers, so replies that aren't in English
 * still get a greeting wave, a nod or an apology face. Matched as plain substrings because word
 * boundaries don't exist in every script. Anything not covered falls back to punctuation below.
 */
const WORDS: { words: string[]; cue: Cue }[] = [
  {
    words: ["नमस्ते", "नमस्कार", "hola", "bonjour", "salut", "guten tag", "hallo", "ciao", "olá", "こんにちは", "안녕하세요", "مرحبا", "வணக்கம்", "নমস্কার"],
    cue: { gesture: "wave", emotion: "happy" },
  },
  {
    words: ["धन्यवाद", "शुक्रिया", "बहुत बढ़िया", "शाबाश", "gracias", "merci", "danke", "grazie", "obrigad", "ありがとう", "감사합니다", "شكرا", "நன்றி", "ধন্যবাদ", "genial", "super", "bravo"],
    cue: { gesture: "nod", emotion: "happy" },
  },
  {
    words: ["माफ़ कीजिए", "माफ कीजिए", "क्षमा", "खेद", "lo siento", "désolé", "desole", "entschuldigung", "tut mir leid", "mi dispiace", "desculp", "すみません", "ごめん", "죄송", "آسف", "மன்னிக்க", "দুঃখিত"],
    cue: { emotion: "sad" },
  },
  {
    words: ["सोचने दीजिए", "सोचता हूँ", "सोचती हूँ", "अच्छा सवाल", "déjame pensar", "buena pregunta", "laissez-moi réfléchir", "bonne question", "lass mich überlegen", "gute frage"],
    cue: { gesture: "think", emotion: "thinking", hold: 3 },
  },
  {
    words: ["क्योंकि", "उदाहरण के लिए", "पहले", "porque", "por ejemplo", "parce que", "par exemple", "weil", "zum beispiel", "perché", "per esempio"],
    cue: { gesture: "explain" },
  },
  { words: ["जी हाँ", "हाँ,", "बिल्कुल", "सही", "sí,", "claro", "oui,", "exactement", "ja,", "genau", "はい", "네,"], cue: { gesture: "nod" } },
];

/** Questions that deserve a visible moment of thought before the answer. */
const THOUGHTFUL = /\b(why|how|explain|what do you think|what would|what if|should i|compare|difference between|calculate|solve|work out|tell me about|describe|opinion|advice|recommend)\b/;

/** Sentence ends, including the Hindi danda and full-width Asian punctuation. */
const SENTENCE_END = /[.!?…]+["')\]]?(\s|$)|[।！？。]+\s*/g;

export function cueForSentence(sentence: string): Cue | null {
  const text = sentence.toLowerCase();
  for (const { pattern, ...cue } of AGENT_RULES) if (pattern.test(text)) return cue;
  for (const { words, cue } of WORDS) if (words.some((w) => text.includes(w))) return cue;
  // No known word (any language): read the punctuation. An exclamation is upbeat; a question from
  // the agent comes with an open, explaining hand.
  const end = text.trim().slice(-1);
  if (end === "!" || end === "！") return { emotion: "happy", gesture: "nod" };
  if (end === "?" || end === "？") return { gesture: "explain" };
  return null;
}

export class CuePlanner {
  /** How much of each streaming caption has been looked at, by caption id. */
  private seen = new Map<string, number>();
  private lastGestureAt = -Infinity;
  private lastGesture: Gesture | undefined;

  constructor(
    /** Seconds between gestures, so the avatar doesn't flail through a long reply. */
    private gap = 2.2,
  ) {}

  /** A finished thing the user said. Returns a "thinking" cue for questions that need thought. */
  onUserText(text: string, now: number): Cue | null {
    const t = text.toLowerCase().trim();
    if (!t) return null;
    const asks = t.endsWith("?") || /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did)\b/.test(t);
    if (!asks && !THOUGHTFUL.test(t)) return null;
    if (!THOUGHTFUL.test(t) && t.length < 60) return null;
    this.lastGestureAt = now;
    this.lastGesture = "think";
    return { gesture: "think", emotion: "thinking", hold: 3 };
  }

  /**
   * The agent's caption so far (it grows as the reply streams). Returns cues for sentences that
   * have been completed since the last call, at most one gesture per `gap` seconds.
   */
  onAgentText(id: string, text: string, final: boolean, now: number): Cue[] {
    let from = this.seen.get(id) ?? 0;
    if (from > text.length) from = 0; // the caption was replaced, start over
    const cues: Cue[] = [];
    SENTENCE_END.lastIndex = from;
    let end = from;
    for (let m = SENTENCE_END.exec(text); m; m = SENTENCE_END.exec(text)) {
      this.plan(text.slice(end, m.index + m[0].length), now, cues);
      end = m.index + m[0].length;
    }
    if (final && end < text.length) {
      this.plan(text.slice(end), now, cues);
      end = text.length;
    }
    if (final) this.seen.delete(id);
    else this.seen.set(id, end);
    if (this.seen.size > 50) this.seen.clear();
    return cues;
  }

  private plan(sentence: string, now: number, out: Cue[]): void {
    const cue = cueForSentence(sentence);
    if (!cue) return;
    const { gesture, ...face } = cue;
    // Expressions always apply; gestures are spaced out and never repeat back to back.
    const allowed = gesture && now - this.lastGestureAt >= this.gap && gesture !== this.lastGesture;
    if (allowed) {
      this.lastGestureAt = now;
      this.lastGesture = gesture;
      out.push(cue);
    } else if (face.emotion) {
      out.push(face);
    }
  }

  reset(): void {
    this.seen.clear();
    this.lastGestureAt = -Infinity;
    this.lastGesture = undefined;
  }
}
