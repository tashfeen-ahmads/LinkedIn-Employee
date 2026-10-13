"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { LINKEDIN_NOTE_LIMITS, checkNote, type LengthStatus } from "@/lib/note-check";

/**
 * The connection note checker. Everything runs in the browser: the text is
 * never sent, logged or stored, which is the promise the page makes.
 */

const EXAMPLE =
  "Hi Priya, your post on moving onboarding to async standups was the clearest take I have read on it. I run ops at a 40-person team and we are trying the same. Would be glad to connect.";

const STATUS: Record<LengthStatus, { pill: string; label: string; detail: (overBy: number) => string }> = {
  empty: { pill: "plain", label: "Nothing to check yet", detail: () => "Paste or type a note above." },
  fits: {
    pill: "positive",
    label: "Fits every account",
    detail: () => `Within ${LINKEDIN_NOTE_LIMITS.free} characters, so it sends from a free account as well as Premium.`,
  },
  premium_only: {
    pill: "warning",
    label: "Premium only",
    detail: (over) =>
      `${over} over the free-account limit of ${LINKEDIN_NOTE_LIMITS.free}. It fits Premium's ${LINKEDIN_NOTE_LIMITS.premium}, but from a free account LinkedIn will not take it as written.`,
  },
  too_long: {
    pill: "danger",
    label: "Too long for any account",
    detail: () => `Over ${LINKEDIN_NOTE_LIMITS.premium} characters, the Premium limit. Cut it down.`,
  },
};

export function NoteChecker() {
  const [text, setText] = useState(EXAMPLE);
  const result = useMemo(() => checkNote(text), [text]);
  const status = STATUS[result.status];
  const problems = result.findings.length + (result.hasLink ? 1 : 0);

  return (
    <div className="card raised stack-4 tool-panel">
      <p className="small muted tool-intro">Paste a note, or edit the example. The result updates as you type.</p>
      <label className="field" htmlFor="tool-note">
        <span>Your connection note</span>
        <span className="hint" id="tool-note-hint">
          Checked in your browser. Nothing you type is sent anywhere or stored.
        </span>
        <textarea
          id="tool-note"
          rows={5}
          value={text}
          aria-describedby="tool-note-hint"
          onChange={(event) => setText(event.target.value)}
        />
      </label>

      <div className="cluster">
        <button type="button" className="chip" onClick={() => setText("")}>
          Clear
        </button>
        <button type="button" className="chip" onClick={() => setText(EXAMPLE)}>
          Load the example
        </button>
      </div>

      <noscript>
        <p className="small muted">
          The live check needs JavaScript. The rules it applies are written out on this page below.
        </p>
      </noscript>

      <div className="stack-3" aria-live="polite">
        <p className="tool-count">
          <strong>{result.length}</strong> characters
          <span className="muted">
            {" "}
            of {LINKEDIN_NOTE_LIMITS.free} (free) or {LINKEDIN_NOTE_LIMITS.premium} (Premium)
          </span>
        </p>
        <div className="cluster">
          <span className={`pill ${status.pill}`}>{status.label}</span>
          <span className="small muted">{status.detail(result.overBy)}</span>
        </div>

        {result.status !== "empty" ? (
          problems === 0 ? (
            <p className="small">
              No link and none of the pitch patterns this checks for. Read it once more as the
              person receiving it: does it say one thing that is true only of them?
            </p>
          ) : (
            <ul className="tool-findings">
              {result.hasLink ? (
                <li>
                  <strong>Carries a link.</strong>{" "}
                  <span className="muted">
                    Links in connection requests cut acceptance and draw LinkedIn&rsquo;s attention.
                    Nora sends a note with a link as no note at all; send the link after they
                    reply.
                  </span>
                </li>
              ) : null}
              {result.findings.map((finding) => (
                <li key={finding.id}>
                  <strong>{finding.label}.</strong>{" "}
                  {finding.matched.length ? (
                    <span>Found: {finding.matched.map((m) => `"${m}"`).join(", ")}. </span>
                  ) : null}
                  <span className="muted">{finding.why}</span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <p className="tool-tie small">
        Nora writes a note like this for every prospect, from their own profile, caps it at{" "}
        {INVITE_NOTE_MAX_CHARS} characters and runs this same link check before it sends.{" "}
        <Link href="/how-it-works">See how it works</Link>
      </p>
    </div>
  );
}
