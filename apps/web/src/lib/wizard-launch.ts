import { checkCtaUrl } from "@le/shared";
import type { WizardStepKey } from "@/lib/wizard";

/*
 * The pure halves of the CTA and launch steps (rule 65), kept apart from the
 * route and the page so they can be tested as written.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * Where a step's form sends somebody back to, with an error code.
 *
 * The launch step carries the campaign it was launching. Without it the page
 * falls back to the newest draft with people on it, so a refused press on one
 * campaign reloaded onto a different one, and the next press launched that.
 * Only a uuid is carried: anything else in the address bar is somebody's
 * hand-made link, and the page would read it as a campaign to look up.
 */
export function stepPath(step: WizardStepKey, params: { error?: string | null; campaign?: string | null } = {}): string {
  const query = new URLSearchParams({ step });
  if (params.error) query.set("error", params.error);
  if (step === "launch" && isUuid(params.campaign)) query.set("campaign", params.campaign);
  return `/onboarding?${query.toString()}`;
}

/**
 * The angle most of the queued people hold, and how many angles there are.
 *
 * Every prospect is assigned an angle when the list is built (rule 28) and an
 * angle that has its own steps owns that person's sequence end to end, so the
 * campaign-wide steps the launch screen used to show were a sequence nobody on
 * the list receives. Ties go to the angle met first, so the screen does not
 * change between two loads of the same list.
 */
export function mostHeldAngle(variantIds: ReadonlyArray<string | null | undefined>): {
  variantId: string | null;
  holders: number;
  angles: number;
} {
  const counts = new Map<string, number>();
  for (const id of variantIds) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best: string | null = null;
  let most = 0;
  for (const [id, n] of counts) {
    if (n > most) {
      best = id;
      most = n;
    }
  }
  return { variantId: best, holders: most, angles: counts.size };
}

/**
 * The steps one angle's people receive, by the send path's own rule
 * (`ownSequence` in the worker): the angle's own when it has any, otherwise the
 * campaign-wide ones.
 */
export function angleSequence<T extends { variant_id?: string | null }>(
  steps: readonly T[],
  variantId: string | null,
): T[] {
  if (variantId) {
    const own = steps.filter((step) => step.variant_id === variantId);
    if (own.length) return own;
  }
  return steps.filter((step) => step.variant_id == null);
}

/** "cal.com/sam" as most people type it, with the scheme the check requires. */
export function withScheme(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * The scheduling link a "Book a meeting" answer saves, if any.
 *
 * The CTA step has a general link box and a scheduling-link box, and somebody
 * choosing a meeting often puts their Calendly address in the first one. It
 * used to be dropped without a word, and the agent then offered times from our
 * own booking page instead of the link they use (rule 31). So the scheduling
 * box wins when filled, and is otherwise taken from the link box only when
 * that is a scheduling page. Any other address there (a homepage, a free-audit
 * page left over from choosing "link" first) would become the link the agent
 * sends to everybody who asks to talk. A bad scheduling link is refused; a bad
 * general link on a meeting campaign is not this step's to refuse.
 */
/** The scheduling services people actually paste. */
const SCHEDULER_HOST =
  /(^|\.)(calendly\.com|cal\.com|savvycal\.com|tidycal\.com|zcal\.co|youcanbook\.me|hubspot\.com|chilipiper\.com|acuityscheduling\.com|calendar\.app\.google|calendar\.google\.com|outlook\.office\.com|outlook\.office365\.com|bookings\.microsoft\.com|doodle\.com)$/i;

export function meetingBookingUrl(
  bookingRaw: string,
  ctaRaw: string,
): { ok: true; url: string | null } | { ok: false } {
  if (bookingRaw.trim()) {
    const checked = checkCtaUrl(withScheme(bookingRaw));
    return checked.ok ? { ok: true, url: checked.url } : { ok: false };
  }
  if (ctaRaw.trim()) {
    const checked = checkCtaUrl(withScheme(ctaRaw));
    if (checked.ok && SCHEDULER_HOST.test(new URL(checked.url).hostname)) return { ok: true, url: checked.url };
  }
  return { ok: true, url: null };
}
