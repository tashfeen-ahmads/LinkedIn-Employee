import { FREE_NOTES_PER_MONTH } from "@le/shared";
import { SEARCH_FILTERS, planLabel, type LinkedInPlan } from "@le/linkedin";
import { Panel, Section } from "@/components/page";
import { NavIcon } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";

const PLANS: ReadonlyArray<{ value: LinkedInPlan; hint: string }> = [
  {
    value: "basic",
    hint: `Notes on ${FREE_NOTES_PER_MONTH} invitations a month, then invitations go without one. Regular LinkedIn search.`,
  },
  { value: "premium", hint: "A note on every invitation. Regular LinkedIn search." },
  {
    value: "sales_navigator",
    hint: "A note on every invitation, and searches filter by seniority and company size too.",
  },
];

/**
 * Which LinkedIn plan the account has, and what that means for sending.
 *
 * Three answers, because they differ in two ways. Sales Navigator changes the
 * search (rule 12). Any paid plan lifts LinkedIn's monthly limit on invitation
 * notes, which a free account has (migration 0045). Said before launch, where
 * somebody can still do something about it, rather than discovered as a
 * campaign that stops after its third invitation.
 *
 * What the rep says and what LinkedIn reports are shown side by side when they
 * disagree. The filters listed are SEARCH_FILTERS, which a test holds to what
 * the search really applies.
 */
export function SalesNavigatorSection({
  plan,
  detected,
  notesLeft,
  connected,
  action,
}: {
  plan: LinkedInPlan;
  /** What the provider reported, or null when it has not been asked or could not say. */
  detected: LinkedInPlan | null;
  /** Free account: notes left this month. Null on a paid plan. */
  notesLeft: number | null;
  /** No account row yet: the answer is kept until Connect. */
  connected: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  const salesNav = plan === "sales_navigator";
  const missing = SEARCH_FILTERS.flatMap((f) => (f.classic ? [] : [f.dropped]));
  const disagrees = detected !== null && detected !== plan;
  return (
    <Section
      id="sales-navigator"
      title="LinkedIn plan"
      description="What the account can do decides how precisely it searches and whether invitations carry a note."
    >
      <Panel className={salesNav ? "sn-panel profile-card is-on" : "sn-panel profile-card"}>
        <div className="sn-head">
          <span className={plan === "basic" ? "pill" : "pill positive"}>{planLabel(plan)}</span>
          <p>
            <strong>{salesNav ? "Searches run on Sales Navigator." : "Searches run on regular LinkedIn search."}</strong>{" "}
            <span className="muted">
              {salesNav
                ? "Every filter in your strategies is applied."
                : `It cannot filter on ${listInWords(missing)}, so lists are broader and need more reading before launch.`}
            </span>
          </p>
        </div>

        <p className="small">
          {notesLeft === null ? (
            <>
              <strong>Invitation notes:</strong> a note on every invitation.
            </>
          ) : (
            <>
              <strong>Invitation notes:</strong> {notesLeft} of {FREE_NOTES_PER_MONTH} left this month. A free
              LinkedIn account can add a note to only {FREE_NOTES_PER_MONTH} invitations a month; after that
              invitations go out without a note until the month turns, which LinkedIn allows.
            </>
          )}
        </p>

        {disagrees ? (
          <div className="notice warning" role="status">
            <p className="small">
              <strong>LinkedIn reports {planLabel(detected!)} on this account.</strong>{" "}
              {detected === "basic"
                ? plan === "sales_navigator"
                  ? "A search on Sales Navigator from an account without it finds nobody, so choose the plan LinkedIn reports."
                  : "Notes are limited to the free allowance until LinkedIn reports a paid plan."
                : detected === "sales_navigator"
                  ? "Choose Sales Navigator below to search with it."
                  : plan === "sales_navigator"
                    ? "A search on Sales Navigator from an account without it finds nobody, so choose Premium below."
                    : "Choose Premium below so every invitation can carry a note."}
            </p>
          </div>
        ) : null}

        <ul className="sn-filters" aria-label="Filters your searches apply">
          {SEARCH_FILTERS.map((filter) => {
            const applied = salesNav || filter.classic;
            return (
              <li key={filter.label} className={applied ? "is-applied" : "is-missing"}>
                {applied ? (
                  <NavIcon name="check" className="sn-filter-icon" />
                ) : (
                  <span className="sn-filter-dash" aria-hidden="true" />
                )}
                <span>{filter.label}</span>
                <span className="sr-only">{applied ? "applied" : "not applied"}</span>
              </li>
            );
          })}
        </ul>

        <form action={action} className="profile-plan-form">
          <fieldset className="profile-choices">
            <legend>Which plan does this LinkedIn account have?</legend>
            {PLANS.map((option) => (
              <label key={option.value} className="profile-choice">
                <input type="radio" name="linkedinPlan" value={option.value} defaultChecked={option.value === plan} />
                <span className="profile-choice-text">
                  <strong>{planLabel(option.value)}</strong>
                  <span className="small muted">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="profile-form-foot">
            <p className="small muted">
              {connected
                ? "Choose the plan this account really has: a search on Sales Navigator from an account without it finds nobody. Premium and Sales Navigator are sold by LinkedIn, not by us."
                : "Kept until you connect your LinkedIn account, then checked with LinkedIn."}
            </p>
            <SubmitButton pendingLabel="Saving…">Save plan</SubmitButton>
          </div>
        </form>
      </Panel>
    </Section>
  );
}

function listInWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
