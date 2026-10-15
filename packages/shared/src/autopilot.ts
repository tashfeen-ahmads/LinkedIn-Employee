/**
 * What autopilot never finishes on its own, however a workspace is set up.
 *
 * One list, because it was written out by hand on five screens and the
 * marketing site, and each copy named a different two or three of these. A
 * customer deciding whether to switch autopilot on is deciding on exactly this
 * list, so the version they read has to be the one the code enforces.
 *
 * Each entry names where it is enforced. Adding a hold to the code without
 * adding it here leaves the screens promising less than the product does,
 * which is harmless; removing one from the code while it stays here is a
 * promise broken under a real rep's name, so change both together.
 */
export interface AutopilotHold {
  id: string;
  /** A short heading, written as a sentence. */
  title: string;
  /** Why it is held, in one or two plain sentences. */
  detail: string;
  /** The same rule as a clause, for joining into one sentence. */
  clause: string;
}

export const AUTOPILOT_ALWAYS_HOLDS: readonly AutopilotHold[] = [
  {
    // applyRules (packages/agents/src/reply.ts), and containsOptOut before any
    // model reads the message (rule 7).
    id: "opt-out",
    title: "Anybody who asks to be removed.",
    detail: "Everything stops for them at once, in every mode, and they are never contacted again.",
    clause: "anybody who asks to be removed stops everything, for good",
  },
  {
    // applyRules: unconditional since rule 41; no setting can turn it off.
    id: "asks-for-a-person",
    title: "A prospect who asks to speak to a person.",
    detail:
      "That is not our caution, it is their wish, and answering it with another automated message would ignore it.",
    clause: "a prospect who asks to speak to a person waits for you",
  },
  {
    // applyRules' confidence floor, and the unread hold in the inbound job.
    id: "not-understood",
    title: "A message the agent is not sure it understood.",
    detail: "A reply written from a misread message reaches a real person just as fast as a good one, so it waits for you.",
    clause: "a message the agent is not sure it understood waits for you",
  },
  {
    // draftLinkCheck in the inbound job (rule 30).
    id: "invented-link",
    title: "A reply carrying a link the agent was not given.",
    detail: "It is held rather than trimmed, because a link nobody supplied means the whole draft drifted.",
    clause: "a reply carrying a link the agent was not given is held",
  },
  {
    // slotsInDraft and the booking step in the inbound job (rule 6).
    id: "unoffered-time",
    title: "A meeting time that was never offered, or is no longer free.",
    detail: "Times come only from your calendar, and an accepted time is checked again before anything is booked.",
    clause: "a meeting time that was never offered, or is no longer free, is held",
  },
  {
    // renderPitch on the send path (rule 40): held as copy, not failed.
    id: "unapproved-offer",
    title: "A follow up built on an offer nobody has approved.",
    detail: "It waits, on schedule, until a person approves the offer, and then sends itself.",
    clause: "a follow up built on an offer nobody has approved waits until one is",
  },
];

/** The whole list as one sentence, for a hint under a setting or an FAQ answer. */
export function alwaysHoldsSentence(): string {
  return `Whatever the setting: ${AUTOPILOT_ALWAYS_HOLDS.map((hold) => hold.clause).join("; ")}.`;
}
