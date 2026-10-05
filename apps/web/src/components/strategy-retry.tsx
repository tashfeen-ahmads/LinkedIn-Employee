import { PostButton } from "@/components/post-button";
import type { StrategySource } from "@/lib/onboarding-stash";

/** Where every retry posts. One address, so the three screens cannot drift. */
export const STRATEGY_RETRY = "/app/strategy/retry";

/**
 * Starts the Strategy Agent again from what onboarding kept.
 *
 * A form, not a link: the old "Try again" was a link to `/onboarding`, which
 * sends anybody with a workspace back to the dashboard they pressed it on.
 */
export function StrategyRetryButton({
  children = "Try again",
  className = "btn small",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <form action={STRATEGY_RETRY} method="post">
      <PostButton className={className} pendingLabel="Starting…">
        {children}
      </PostButton>
    </form>
  );
}

/**
 * What Sage should read, for a workspace whose onboarding answer was not kept.
 *
 * The same three fields onboarding asks for, with the same rule: one of them is
 * required, because the agent will not invent a business from nothing. Filled
 * in with whatever was kept, so a correction is an edit rather than a retype.
 */
export function StrategyDetailsForm({ source = {} }: { source?: StrategySource }) {
  return (
    <div className="card" id="details">
      <form action={STRATEGY_RETRY} method="post" className="stack-3">
        <label className="field">
          <span>Website</span>
          <input name="websiteUrl" type="url" placeholder="https://acme.com" defaultValue={source.websiteUrl ?? ""} />
        </label>
        <label className="field">
          <span>LinkedIn company page</span>
          <input
            name="linkedinCompanyUrl"
            type="url"
            placeholder="https://linkedin.com/company/acme"
            defaultValue={source.linkedinCompanyUrl ?? ""}
          />
        </label>
        <label className="field">
          <span>Anything else worth knowing</span>
          <textarea
            name="description"
            rows={4}
            maxLength={2000}
            placeholder="Who you sell to, what you charge, what makes you different."
            defaultValue={source.description ?? ""}
          />
          <span className="hint">
            A website or a description — one of them is required. Sage will not invent a business
            from nothing.
          </span>
        </label>
        <PostButton className="btn" pendingLabel="Reading your site…">
          Build my profiles
        </PostButton>
      </form>
    </div>
  );
}
