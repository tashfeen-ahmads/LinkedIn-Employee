/**
 * The pitch, put into a message at send time.
 *
 * Rule 40's sibling to rule 29's `{{cta_link}}`, and the same argument: the
 * offer is not written into a campaign's copy, so improving it improves every
 * campaign at once instead of meaning three rewrites and three more reviews.
 * A business that had to retype its pitch into each campaign would have four
 * versions of it within a month, and no screen able to say which prospect got
 * which.
 */
export const PITCH_PLACEHOLDER = "{{pitch}}";

export function usesPitch(message: string): boolean {
  return message.includes(PITCH_PLACEHOLDER);
}

/**
 * Substitutes the approved pitch, or refuses.
 *
 * Unlike `renderCta`, an unresolved pitch is not left visible on the message
 * and sent anyway. A missing destination costs a link; a missing pitch is the
 * whole body of the message, and what would go out is either the literal
 * characters `{{pitch}}` or — worse — a greeting with nothing after it. Both
 * reach a real person under a real rep's name.
 *
 * So the caller is told it cannot send, and why. Nothing is ever sent
 * half-written.
 */
export function renderPitch(
  message: string,
  pitch: string | null | undefined,
): { ok: true; message: string } | { ok: false; reason: string } {
  if (!usesPitch(message)) return { ok: true, message };

  const body = pitch?.trim();
  if (!body) {
    return {
      ok: false,
      reason:
        "this message is built from your pitch, and there is no approved pitch to put in it — write one on Your pitch and approve it",
    };
  }

  const rendered = message.split(PITCH_PLACEHOLDER).join(body).trim();
  if (!rendered) {
    return { ok: false, reason: "substituting the pitch left an empty message" };
  }
  return { ok: true, message: rendered };
}
