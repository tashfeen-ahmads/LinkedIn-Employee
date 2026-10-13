import { PUBLIC_LIMITS } from "@/lib/site";
import { BRAND, LINKEDIN_LIMITS } from "@le/shared";
import { dailyInviteCap } from "@le/linkedin";
import { FREE_LINE } from "./marketing";

/**
 * What the form is for, beside the form.
 *
 * A column of inputs alone on a wide screen is the one moment this product has
 * nothing to say for itself, and it is the moment somebody is deciding whether
 * to hand over their details.
 *
 * It shows the product working rather than describing it. A list of claims is
 * a list of claims; these are the shapes off the real screens: an allowance
 * drawn against its cap, an acceptance, a reply waiting for a person. So what
 * a new customer sees here is what they will recognize on day one. The numbers
 * are read from the same constants and the same function the limiter obeys,
 * because a panel quoting a cap the product does not keep would be worse than
 * an empty one.
 *
 * Hidden below 60em, where the job is the form and a marketing block above it
 * is something to scroll past. Not shown on password recovery at all: a sales
 * panel beside "reset your password" is talking to somebody who already chose.
 */
export function AuthAside({ variant = "signin" }: { variant?: "signin" | "signup" }) {
  /*
   * Day 1, drawn against day 1's own cap.
   *
   * This drew the starting allowance against the ceiling, "10 of 35", which
   * says 25 more are allowed today. They are not: the ramp starts at an
   * account's first action (rule 3), and an account that has sent nothing
   * sits at the starting cap. So today's cap is `dailyInviteCap` for an
   * account with no first action, the meter is full, and the ceiling is said
   * as what the ramp rises to.
   */
  const cap = dailyInviteCap(null);
  const sent = cap;
  const filled = Math.round((sent / cap) * 100);

  return (
    <aside className="auth-aside" aria-label={`What ${BRAND.name} does`}>
      {variant === "signup" ? (
        <p className="auth-badge">
          {FREE_LINE} No card.
        </p>
      ) : null}

      <div className="stack-3">
        <p className="auth-kicker">An AI SDR that works inside the limits</p>
        <p className="lede prose">
          {variant === "signup"
            ? `Give ${BRAND.name} your website and it drafts who to go after. You approve a strategy and the words, then press launch. ${BRAND.name} finds the people, writes to each one by name and drafts your replies.`
            : `${BRAND.name} finds the people, writes to each one by name and drafts your replies to what comes back, at a pace that keeps a LinkedIn account safe.`}
        </p>
      </div>

      {/*
        A day in the product, in three cards. Marked `aria-hidden` and summarized
        in one sentence underneath: read aloud, a stack of fragments is noise,
        and the sentence is what it all amounts to.
      */}
      <div className="auth-stack" aria-hidden="true">
        <div className="auth-card">
          <div className="auth-card-head">
            <span className="auth-card-label">Invitations today</span>
            <span className="auth-card-value">
              {sent} of {cap}
            </span>
          </div>
          <div className="auth-gauge">
            <span style={{ width: `${filled}%` }} />
          </div>
          <span className="auth-card-note">
            Day 1 of the warm-up. The daily allowance rises to {PUBLIC_LIMITS.invitesPerDayMax} over{" "}
            {LINKEDIN_LIMITS.warmupDays} days, and never past {PUBLIC_LIMITS.invitesPerWeek} in a week.
          </span>
        </div>

        <div className="auth-card">
          <div className="auth-card-head">
            <span className="auth-card-label">Accepted your invitation</span>
            <span className="auth-card-value">Dana R.</span>
          </div>
          <span className="auth-card-note">
            Your first message usually follows within a couple of hours of the acceptance, inside
            your working hours.
          </span>
        </div>

        <div className="auth-card">
          <div className="auth-card-head">
            <span className="auth-card-label">A reply comes in</span>
            <span className="auth-card-value">“Can I talk to a person?”</span>
          </div>
          <span className="auth-card-note">
            Somebody who asks for a human always reaches you, on autopilot or not. Every other reply
            is drafted only from facts you gave {BRAND.name}.
          </span>
          <span className="auth-pill">Held for you</span>
        </div>
      </div>

      <p className="sr-only">
        A worked example: {sent} invitations on the first day, the whole of day 1&rsquo;s allowance,
        rising to {PUBLIC_LIMITS.invitesPerDayMax} a day over the warm-up; an acceptance followed up
        within a couple of hours; and a prospect asking for a person held for you to answer.
      </p>
    </aside>
  );
}
