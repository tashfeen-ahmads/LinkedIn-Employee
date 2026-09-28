import { PUBLIC_LIMITS } from "@/lib/site";

/**
 * What the form is for, beside the form.
 *
 * A column of inputs alone on a wide screen is the one moment this product has
 * nothing to say for itself, and it is the moment somebody is deciding whether
 * to hand over their details. So the panel carries the numbers rather than a
 * slogan: they are the argument, they are enforced in code, and they are read
 * from the same constants the limiter obeys — a panel quoting a cap the
 * product does not keep would be worse than an empty one.
 *
 * Hidden below 60em, where the job is the form.
 */
export function AuthAside() {
  return (
    <aside className="auth-aside" aria-label="About this product">
      <div className="stack-3">
        <p className="eyebrow">An AI SDR that works inside the limits</p>
        <p className="lede prose">
          It finds the people, writes to each one by name, answers what comes back and books the
          call — at a pace that keeps a LinkedIn account alive.
        </p>
      </div>

      <div className="auth-points">
        <div className="auth-point">
          <strong>{PUBLIC_LIMITS.invitesPerDayStart} invitations on day one</strong>
          <span className="small muted">
            Ramping to {PUBLIC_LIMITS.invitesPerDayMax} a day over the warm-up, never more than{" "}
            {PUBLIC_LIMITS.invitesPerWeek} in a week. The caps are product rules, not settings.
          </span>
        </div>
        <div className="auth-point">
          <strong>Nobody is contacted twice</strong>
          <span className="small muted">
            Not across campaigns, and not after a reply. Checked in the second before every send,
            not only when the list was built.
          </span>
        </div>
        <div className="auth-point">
          <strong>Three decisions are yours</strong>
          <span className="small muted">
            Approve a strategy, approve the words, press launch. The agents run the rest, and you
            can take any of it over by hand.
          </span>
        </div>
      </div>

      <p className="tiny subtle prose">
        Not affiliated with LinkedIn Corporation. LinkedIn is a trademark of its owner, and
        automated access is against their user agreement — which is why the limits on this site are
        what they are.
      </p>
    </aside>
  );
}
