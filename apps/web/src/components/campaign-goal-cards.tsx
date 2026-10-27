"use client";

import type { ReactNode } from "react";
import type { CtaKind } from "@le/shared";
import { NavIcon } from "@/components/icons";

/**
 * What a campaign asks for, as cards rather than a dropdown.
 *
 * The goal decides the copy, what the agent pursues in a reply and what the
 * funnel counts as success (rule 29), and it was a `<select>` whose options
 * read "Free audit (Send them a link)". A person choosing between "book a
 * call" and "send them to the sign-up page" is choosing what the campaign is
 * for; the cards say what each one sends, so the choice is made by reading
 * rather than by remembering what a library entry was called.
 *
 * Two screens use it, the campaign's Goal & link section and step 2 of the
 * builder, and both post to `ctaPatchFor`, which is the one reading of what a
 * card means: a saved entry by its id, a goal with no entry yet as
 * `kind:<goal>` (made with `ensureCta`), or empty for the campaign's own
 * destination.
 *
 * A client component only so that typing a new link selects its card. Without
 * script the radio is pressed by hand and everything still posts. The goals'
 * names arrive as a prop (`goalLabels`, from `CTA_DEFINITIONS`) rather than
 * by importing the shared package, which would ship all of it to the browser
 * for three words.
 */
export interface GoalCardEntry {
  id: string;
  name: string;
  kind: CtaKind;
  label: string | null;
  url: string | null;
}

const ICON: Record<CtaKind, string> = { meeting: "meetings", link: "cta", reply: "inbox" };

export function CampaignGoalCards({
  library,
  selected,
  meetingSends,
  ownDestination,
  goalLabels,
  children,
}: {
  /** Each goal's name, `goalLabels[kind]`. */
  goalLabels: Record<CtaKind, string>;
  /** The workspace's saved calls to action, not archived. */
  library: GoalCardEntry[];
  /** The card checked when the page opens. */
  selected: string;
  /** What a meeting goal sends, in words: the rep's own link or the booking page. */
  meetingSends: string;
  /** "This campaign's own destination", offered only to a campaign that has one. */
  ownDestination?: { kind: CtaKind; label: string | null; url: string | null } | null;
  /** The form's buttons, under the cards. */
  children?: ReactNode;
}) {
  // What each card does, in the words a business owner would use.
  const does = (kind: CtaKind, url: string | null): string =>
    kind === "meeting"
      ? meetingSends
      : kind === "link"
        ? url
          ? `Sends them to ${shortUrl(url)}`
          : "No link chosen yet"
        : "Just asks them to reply";

  // One card per thing a campaign can actually do. A meeting entry and the
  // plain "Book a meeting" both send the same booking link, so offering both
  // put the same goal on screen twice under two names; the saved one wins.
  // The same goes for a conversation. A new link is always offered, because
  // a second link is a different destination.
  // The campaign's own destination, unless a saved entry already says exactly
  // the same thing; then that entry is the one shown as chosen.
  const twin = ownDestination
    ? library.find(
        (entry) =>
          entry.kind === ownDestination.kind &&
          (entry.url ?? "") === (ownDestination.url ?? "") &&
          (ownDestination.kind !== "link" || Boolean(entry.url)),
      ) ?? null
    : null;
  const own = ownDestination && !twin ? ownDestination : null;
  const chosen = selected === "" && twin ? twin.id : selected;
  const saved = (kind: CtaKind) => library.some((entry) => entry.kind === kind) || (own !== null && own.kind === kind);
  const fresh = (["meeting", "link", "reply"] as const).filter((kind) => kind === "link" || !saved(kind));

  return (
    <fieldset className="campaign-goals">
      <legend className="sr-only">What this campaign asks for</legend>
      <div className="campaign-goal-grid">
        {own ? (
          <div className="campaign-goal">
            <label className="campaign-goal-pick">
              <input type="radio" name="ctaId" value="" defaultChecked={selected === ""} />
              <NavIcon name={ICON[own.kind]} className="campaign-goal-icon" />
              <span className="campaign-goal-title">{own.label || goalLabels[own.kind]}</span>
              <span className="campaign-goal-hint">{does(own.kind, own.url)}</span>
            </label>
          </div>
        ) : null}
        {library.map((entry) => (
          <div className="campaign-goal" key={entry.id}>
            <label className="campaign-goal-pick">
              <input type="radio" name="ctaId" value={entry.id} defaultChecked={chosen === entry.id} />
              <NavIcon name={ICON[entry.kind]} className="campaign-goal-icon" />
              <span className="campaign-goal-title">{entry.name}</span>
              <span className="campaign-goal-hint">{does(entry.kind, entry.url)}</span>
            </label>
          </div>
        ))}
        {fresh.map((kind) => (
          <div className="campaign-goal" key={kind}>
            <label className="campaign-goal-pick">
              <input type="radio" name="ctaId" value={`kind:${kind}`} defaultChecked={chosen === `kind:${kind}`} />
              <NavIcon name={ICON[kind]} className="campaign-goal-icon" />
              <span className="campaign-goal-title">
                {kind === "link" ? (saved("link") ? "A different link" : "Send a link") : goalLabels[kind]}
              </span>
              <span className="campaign-goal-hint">
                {kind === "meeting" ? meetingSends : kind === "link" ? "A sign-up page, an offer or a product page" : "Just asks them to reply"}
              </span>
            </label>
          </div>
        ))}
      </div>
      {/*
        The new link's two fields, under the cards rather than inside one of
        them: a form inside a card read as a second form. Shown once its card
        is picked (CSS, so it works without script), and typing in it picks the
        card for anybody who reached it another way.
      */}
      <div className="campaign-goal-newlink">
        <label className="field">
          <span>Web address</span>
          <input
            type="url"
            name="url-link"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.com/sign-up…"
            onFocus={pickNewLink}
          />
        </label>
        <label className="field">
          <span>
            What to call it <span className="hint">optional</span>
          </span>
          <input type="text" name="label-link" maxLength={80} autoComplete="off" placeholder="Free audit…" onFocus={pickNewLink} />
        </label>
      </div>
      {children}
    </fieldset>
  );
}

/** Typing a new link means choosing the new-link card. */
function pickNewLink(event: React.FocusEvent<HTMLInputElement>) {
  const radio = event.currentTarget
    .closest(".campaign-goals")
    ?.querySelector<HTMLInputElement>('input[type="radio"][value="kind:link"]');
  if (radio) radio.checked = true;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
