"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { OPT_OUT_PHRASES } from "@le/shared";

/*
 * A playable version of the reply gate.
 *
 * The opt-out check here is the product's own: OPT_OUT_PHRASES is the same
 * constant the worker imports, and the same substring test runs before any
 * model is consulted. The other conditions are keyword stand-ins for what a
 * classifier decides — said so on the page rather than implied, because a demo
 * that overclaims is the thing this product is trying not to be.
 */

type Verdict = {
  rule: string;
  outcome: "stops" | "waits" | "sends";
  because: string;
};

const HOLD_RULES: ReadonlyArray<{ rule: string; because: string; test: RegExp }> = [
  {
    rule: "Asks about price",
    because: "Pricing goes to a person on every plan, including autopilot.",
    test: /\b(cost|price|pricing|how much|budget|quote|discount|per seat|contract)\b/i,
  },
  {
    rule: "Raises legal or security",
    because: "Security, compliance and data questions are never answered by a machine.",
    test: /\b(gdpr|dpa|security|compliance|legal|soc ?2|privacy|contract terms|procurement)\b/i,
  },
  {
    rule: "Asks to speak to a person",
    because: "Someone who asks who they are talking to gets a person.",
    test: /\b(who am i (talking|speaking)|are you a (bot|human|robot)|real person|speak to someone)\b/i,
  },
  {
    rule: "Sounds annoyed",
    because: "Negative sentiment is handed over rather than smoothed over.",
    test: /\b(spam|annoying|stop wasting|rude|unprofessional|how did you get|ridiculous)\b/i,
  },
];

const BOOKING = /\b(tuesday|wednesday|thursday|monday|friday|works for me|sounds good|book|calendar|happy to chat|let'?s talk)\b/i;

function judge(message: string): Verdict | null {
  const text = message.trim();
  if (!text) return null;

  const lower = text.toLowerCase();

  // First, and deterministically. Rule 5 in CLAUDE.md: sending after "remove
  // me" is the one mistake this product cannot make, so it is never left to a
  // model's judgement.
  const phrase = OPT_OUT_PHRASES.find((p) => lower.includes(p));
  if (phrase) {
    return {
      rule: `Matched “${phrase}”`,
      outcome: "stops",
      because: "Checked against a fixed list before any model runs. Nothing is ever sent after this.",
    };
  }

  for (const rule of HOLD_RULES) {
    if (rule.test.test(text)) return { rule: rule.rule, outcome: "waits", because: rule.because };
  }

  if (BOOKING.test(text)) {
    return {
      rule: "Reads as interest",
      outcome: "sends",
      because: "A reply is drafted offering times you are genuinely free. On approval mode it waits for your click.",
    };
  }

  return {
    rule: "Nothing caught it",
    outcome: "sends",
    because: "A reply is drafted from your knowledge base only. Anything it cannot answer from there is handed to you.",
  };
}

const EXAMPLES = [
  "Interesting — what does this actually cost for a team of six?",
  "Please remove me from your list.",
  "Where is our data held? We need a DPA before anything else.",
  "Sounds good, Tuesday works for me.",
  "How did you even get my details? This is spam.",
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
              {example.length > 34 ? `${example.slice(0, 32)}…` : example}
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
            <p className="small subtle">Nothing to judge yet — type something above.</p>
          )}
        </AnimatePresence>
      </div>

      <p className="tiny subtle">
        The opt-out check above is the product&rsquo;s own code running in your browser, against the
        same phrase list the sender uses. The other conditions are keyword stand-ins here; in the
        product a classifier decides them, and it errs toward handing over.
      </p>
    </div>
  );
}
