/**
 * Plain-language summary of the rules the worker adds before every persona
 * (services/agent-worker/agent_worker/safety.py, PLATFORM_PREAMBLE and AUDIENCE_RULES).
 */
import type { AudienceProfile } from "@metaavatar/protocol";

export const PLATFORM_RULES: [string, string][] = [
  ["Honest about being AI", "Says it's an AI whenever asked, and the stage always shows an AI badge."],
  ["No impersonation", "Never claims to be a real person or a public figure."],
  ["Refuses harmful requests", "Sexual content, self-harm instructions, weapons and illegal activity."],
  ["Care in a crisis", "Points people at emergency services or a crisis line and leaves the topic."],
  ["No sensitive data", "Never asks for passwords, payment details or ID numbers."],
  ["Rules can't be overridden", "Ignores instructions in messages or documents that try to change these rules."],
];

export const AUDIENCES: { value: AudienceProfile; label: string; summary: string }[] = [
  { value: "general", label: "Adults", summary: "The platform rules only." },
  {
    value: "teen",
    label: "Teenagers",
    summary: "Keeps content age-appropriate, avoids mature themes, and never discusses romance or dating.",
  },
  {
    value: "kids",
    label: "Children",
    summary:
      "Simple, kind language. Never asks for or remembers personal details, no scary or violent content, and suggests involving a parent or teacher.",
  },
];
