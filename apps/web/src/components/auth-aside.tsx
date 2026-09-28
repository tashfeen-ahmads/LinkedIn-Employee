import { PUBLIC_LIMITS } from "@/lib/site";

/**
 * What the form is for, beside the form.
 *
 * A column of inputs alone on a wide screen is the one moment this product has
 * nothing to say for itself, and it is the moment somebody is deciding whether
 * to hand over their details.
 *
 * It shows the product working rather than describing it. A list of claims is
 * a list of claims; these are the shapes off the real screens — an allowance
 * drawn against its cap, an acceptance, a reply waiting for a person — so what
 * a new customer sees here is what they will recognise on day one. The numbers
 * are read from the same constants the limiter obeys, because a panel quoting
 * a cap the product does not keep would be worse than an empty one.
 *
 * Hidden below 60em, where the job is the form and a marketing block above it
 * is something to scroll past.
 */
export function AuthAside({ variant = "signin" }: { variant?: "signin" | "signup" }) {
  // Drawn against the cap, never against the largest number on screen: a meter
  // scaled to its own data always looks full, and 10 of 35 and 10 of 10 are
  // then the same picture (rule 51).
  const today = PUBLIC_LIMITS.invitesPerDayStart;
  const cap = PUBLIC_LIMITS.invitesPerDayMax;
  const filled = Math.round((today / cap) * 100);

  return (
    <aside className="auth-aside" aria-label="What this product does">
      {/*
        The two pages arrive at this panel from different places. Somebody
        signing in has already decided; somebody signing up is deciding, and
        the first thing they want to know is what it costs to find out. One
        component either way, because two would drift — and the cards below are
        the same on both, since the product is the same product.
      */}
      {variant === "signup" ? (
        <p className="auth-badge">Seven days free · no card</p>
      ) : null}

      <div className="stack-3">
        <p className="eyebrow">An AI SDR that works inside the limits</p>
        <p className="lede prose">
          {variant === "signup"
            ? "Give it your website and it writes who to go after. You approve a strategy, approve the words, and press launch — it finds the people, writes to each one by name, and answers what comes back."
            : "It finds the people, writes to each one by name, answers what comes back and books the call — at a pace that keeps a LinkedIn account alive."}
        </p>
      </div>

      {/*
        A day in the product, in three cards. Marked `aria-hidden` and summarised
        in one sentence underneath: read aloud, a stack of fragments — "Invites
        today", "10 of 35", "Day 1 of the warm-up" — is noise, and the sentence
        is what it all amounts to.
      */}
      <div className="auth-stack" aria-hidden="true">
        <div className="auth-card">
          <div className="auth-card-head">
            <span className="auth-card-label">Invitations today</span>
            <span className="auth-card-value">
              {today} of {cap}
            </span>
          </div>
          <div className="auth-gauge">
            <span style={{ width: `${filled}%` }} />
          </div>
          <span className="auth-card-note">
            Day 1 of the warm-up. It rises on its own, and never past{" "}
            {PUBLIC_LIMITS.invitesPerWeek} in a week.
          </span>
        </div>

        <div className="auth-card">
          <div className="auth-card-head">
            <span className="auth-card-label">Accepted</span>
            <span className="auth-card-value">Dana R.</span>
          </div>
          <span className="auth-card-note">
            Your opener goes out within the hour — not three days later, and not while she is
            asleep.
          </span>
        </div>

        <div className="auth-card">
          <div className="auth-card-head">
            <span className="auth-card-label">Reply drafted</span>
            <span className="auth-card-value">“What does this cost?”</span>
          </div>
          <span className="auth-card-note">
            Answered only from facts you gave it. On autopilot it sends; set to review, it waits
            for you.
          </span>
          <span className="auth-pill">Held for you</span>
        </div>
      </div>

      <p className="sr-only">
        A worked example: {today} invitations on the first day against a cap of {cap}, an acceptance
        followed up within the hour, and a pricing question drafted and held for a person to read.
      </p>

      <p className="auth-foot">
        Not affiliated with LinkedIn Corporation. LinkedIn is a trademark of its owner, and
        automated access is against their user agreement — which is why the limits here are what
        they are.
      </p>
    </aside>
  );
}
