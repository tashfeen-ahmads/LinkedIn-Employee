"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BRAND, findOptOutPhrase } from "@le/shared";
import { ReplyGate } from "./reply-gate";

/*
 * A playable version of the reply gate.
 *
 * The opt-out check here is the product's own: `findOptOutPhrase` reads the
 * same OPT_OUT_PHRASES the worker does, through the same normalisation, before
 * any model is consulted. The other conditions are keyword stand-ins for what a
 * classifier decides, said so on the page rather than implied, because a demo
 * that overclaims is the thing this product is trying not to be.
 */

type Verdict = {
  rule: string;
  outcome: "stops" | "waits" | "sends";
  because: string;
  /** The row of the drawn gate this verdict lands on. */
  gate: string;
};

const HOLD_RULES: ReadonlyArray<{ rule: string; because: string; test: RegExp }> = [
  {
    rule: "Asks to speak to a person",
    because: "Someone who asks for a person gets one. This hold stays on in every mode, autopilot included.",
    test: /\b(who am i (talking|speaking)|are you a (bot|human|robot)|real person|speak to someone)\b/i,
  },
  {
    rule: "Asks about price",
    because: "Pricing waits for a person by default. You can let Reese answer it; the facts still come only from what you gave it.",
    test: /\b(cost|price|pricing|how much|budget|quote|discount|per seat|contract)\b/i,
  },
  {
    rule: "Raises legal or security",
    because: "Security, compliance and data questions wait for a person by default, like pricing.",
    test: /\b(gdpr|dpa|security|compliance|legal|soc ?2|privacy|contract terms|procurement)\b/i,
  },
  {
    rule: "Sounds annoyed",
    because: "An annoyed reply waits for a person by default rather than being smoothed over by a machine.",
    test: /\b(spam|annoying|stop wasting|rude|unprofessional|how did you get|ridiculous)\b/i,
  },
];

const BOOKING = /\b(tuesday|wednesday|thursday|monday|friday|works for me|sounds good|book|calendar|happy to chat|let'?s talk)\b/i;

function judge(message: string): Verdict | null {
  const text = message.trim();
  if (!text) return null;

  // First, and deterministically. Rule 7 in CLAUDE.md: sending after "remove
  // me" is the one mistake this product cannot make, so it is never left to a
  // model's judgement.
  const phrase = findOptOutPhrase(text);
  if (phrase) {
    return {
      rule: `Matched “${phrase}”`,
      outcome: "stops",
      because: "Checked against a fixed list before any model runs. Nothing is ever sent after this.",
      gate: "Asked to be removed",
    };
  }

  for (const rule of HOLD_RULES) {
    if (rule.test.test(text)) return { rule: rule.rule, outcome: "waits", because: rule.because, gate: rule.rule };
  }

  if (BOOKING.test(text)) {
    return {
      rule: "Reads as interest",
      outcome: "sends",
      because: "A reply is drafted offering times you have open. By default it waits for your approval; on autopilot it sends.",
      gate: "else",
    };
  }

  return {
    rule: "Nothing caught it",
    outcome: "sends",
    because: "A reply is drafted from your documents only. Anything it cannot answer from there is handed to you.",
    gate: "else",
  };
}

/*
 * Short enough to read whole on a chip at any width. They used to be sliced to
 * fit, which put "What does this actu..." on the page as if the sentence broke.
 */
const EXAMPLES = [
  "What does it cost for six of us?",
  "Please remove me from your list.",
  "Can you send your DPA first?",
  "Tuesday works for me.",
  "This feels like spam.",
];

const TONE = {
  stops: { pill: "danger", label: "Stops for good" },
  waits: { pill: "warning", label: "Waits for you" },
  sends: { pill: "positive", label: "A reply is drafted" },
} as const;

export function GateSimulator() {
  const [message, setMessage] = useState(EXAMPLES[0]!);
  const verdict = useMemo(() => judge(message), [message]);
  const reduced = useReducedMotion();

  return (
    <div className="mk-pair sim-pair">
    <div className="sim card raised stack-4">
      <div className="stack-2">
        <label className="field" htmlFor="sim-message">
          <span>Write what a prospect might reply</span>
          <textarea
            id="sim-message"
            rows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Type a reply and watch which rule catches it…"
          />
        </label>

        <div className="cluster" role="group" aria-label="Example replies">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="chip"
              onClick={() => setMessage(example)}
              aria-pressed={message === example}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      <div className="sim-result" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {verdict ? (
            <motion.div
              key={verdict.rule + verdict.outcome}
              initial={reduced ? false : { opacity: 0.001, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0.001, y: -6 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="stack-2"
            >
              <div className="cluster">
                <span className={`pill ${TONE[verdict.outcome].pill}`}>
                  {TONE[verdict.outcome].label}
                </span>
                <span className="small muted">{verdict.rule}</span>
              </div>
              <p className="small">{verdict.because}</p>
            </motion.div>
          ) : (
            <p className="small subtle">Nothing to judge yet. Type something above.</p>
          )}
        </AnimatePresence>
      </div>

      <p className="tiny subtle prose sim-note">
        The opt-out check here uses the same phrase list {BRAND.name} checks before every send. The other
        checks are simplified for this demo; in the product an AI model judges them, and when it is
        unsure it hands the reply to you.
      </p>
    </div>
    <ReplyGate active={verdict?.gate ?? null} />
    </div>
  );
}
