"""Cheap semantic gesture planner: picks gestures/emotions from transcript text.

Runs alongside the model's own `express` tool calls, so the avatar still moves naturally when the
model doesn't call the tool.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .protocol_models import Emotion, Gesture

_RULES: list[tuple[re.Pattern[str], Gesture | None, Emotion | None]] = [
    (re.compile(r"\b(hi|hello|hey|welcome|good (morning|afternoon|evening))\b"), Gesture.wave, Emotion.happy),
    (re.compile(r"\b(bye|goodbye|see you|take care)\b"), Gesture.wave, Emotion.happy),
    (re.compile(r"\b(congrat\w*|awesome|amazing|fantastic|well done|great job)\b"), Gesture.celebrate, Emotion.happy),
    (re.compile(r"\b(sorry|unfortunately|sad)\b"), None, Emotion.sad),
    (re.compile(r"\b(wow|really\?|no way|surpris\w*)\b"), None, Emotion.surprised),
    (re.compile(r"\b(hmm|let me think|good question|i wonder)\b"), Gesture.think, Emotion.thinking),
    (re.compile(r"\b(i'?m not sure|i don'?t know|maybe)\b"), Gesture.shrug, None),
    (re.compile(r"\b(yes|exactly|right|correct|absolutely|sure)\b"), Gesture.nod, None),
    (re.compile(r"\b(no|not really|nope)\b"), Gesture.shake_head, None),
    (re.compile(r"\b(first|second|third|step|because|for example|the reason)\b"), Gesture.explain, None),
    (re.compile(r"\b(look at|over there|this one|on the left|on the right)\b"), Gesture.point, None),
]


@dataclass(frozen=True)
class Cue:
    gesture: Gesture | None
    emotion: Emotion | None


def plan_cues(text: str, max_cues: int = 2) -> list[Cue]:
    """Return up to `max_cues` cues for a sentence, in rule priority order."""
    lowered = text.lower()
    cues: list[Cue] = []
    for pattern, gesture, emotion in _RULES:
        if pattern.search(lowered):
            cues.append(Cue(gesture, emotion))
            if len(cues) >= max_cues:
                break
    return cues
