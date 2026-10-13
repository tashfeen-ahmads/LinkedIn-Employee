import { SEARCH_FILTERS } from "@le/linkedin";
import { Panel, Section } from "@/components/page";
import { NavIcon } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";

/**
 * Which search the account runs, as a setting somebody can see and change in
 * one press rather than a checkbox inside the edit form under sending hours.
 *
 * The filters listed are SEARCH_FILTERS, the same list the website shows and
 * a test holds to what the search really applies (rule 12).
 *
 * Turning it on is the costly mistake: a search on a tier the account does not
 * have returns nobody, which reads as "your customer profile matched nobody".
 * So the button that turns it on says what it requires.
 */
export function SalesNavigatorSection({
  on,
  connected,
  action,
}: {
  on: boolean;
  /** No account row yet: the answer lives in the edit form until Connect. */
  connected: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  const missing = SEARCH_FILTERS.flatMap((f) => (f.classic ? [] : [f.dropped]));
  return (
    <Section
      id="sales-navigator"
      title="Sales Navigator"
      description="Which LinkedIn search finds your prospects."
    >
      <Panel className={on ? "sn-panel is-on" : "sn-panel"}>
        <div className="sn-head">
          <span className={on ? "pill positive" : "pill"}>{on ? "On" : "Off"}</span>
          <p>
            {on ? (
              <strong>Searches run on Sales Navigator.</strong>
            ) : (
              <strong>Searches run on regular LinkedIn search.</strong>
            )}{" "}
            <span className="muted">
              {on
                ? "Every filter in your strategies is applied."
                : `It cannot filter on ${listInWords(missing)}, so lists are broader and need more reading before launch.`}
            </span>
          </p>
        </div>

        <ul className="sn-filters" aria-label="Filters your searches apply">
          {SEARCH_FILTERS.map((filter) => {
            const applied = on || filter.classic;
            return (
              <li key={filter.label} className={applied ? "is-applied" : "is-missing"}>
                {applied ? <NavIcon name="check" className="sn-filter-icon" /> : <span className="sn-filter-dash" aria-hidden="true" />}
                <span>{filter.label}</span>
                <span className="sr-only">{applied ? "applied" : "not applied"}</span>
              </li>
            );
          })}
        </ul>

        {connected ? (
          <form action={action} className="sn-action">
            <input type="hidden" name="value" value={on ? "off" : "on"} />
            {on ? (
              <>
                <p className="small muted">
                  Turn this off if the subscription has ended. A search on Sales Navigator from an
                  account without it finds nobody.
                </p>
                <SubmitButton className="btn secondary small" pendingLabel="Saving…">
                  Turn off Sales Navigator
                </SubmitButton>
              </>
            ) : (
              <>
                <p className="small muted">
                  Only turn this on if this LinkedIn account has a Sales Navigator subscription. It is
                  sold by LinkedIn, not by us.
                </p>
                <SubmitButton className="btn small" pendingLabel="Saving…">
                  I have Sales Navigator, turn it on
                </SubmitButton>
              </>
            )}
          </form>
        ) : (
          <p className="small muted sn-action">
            Connect your LinkedIn account below, then turn this on here if the account has Sales
            Navigator.
          </p>
        )}
      </Panel>
    </Section>
  );
}

function listInWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
