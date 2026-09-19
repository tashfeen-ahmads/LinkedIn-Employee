import Link from "next/link";
import { PageHeader } from "@/components/page";
import { TOUR_STAGES, stageStatus } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { readSetupState } from "@/lib/setup-state";

/**
 * The product, explained in order, against where this workspace actually is.
 *
 * Not a generic help page. A tour that describes a product in the abstract
 * leaves the reader to work out which paragraph is about them, and the answer
 * was always knowable — `readSetupState` computes it for the sidebar on every
 * request. So each stage is marked done, current or ahead, from the same
 * reading the nav and the dashboard use (rule 32).
 *
 * Every stage states its limit as plainly as its capability. The failures this
 * product has actually had were screens that were quiet about an edge: a funnel
 * counting meetings a campaign never asked for, an acceptance a day late
 * reading as a stalled campaign. Somebody who learns the limits here does not
 * file those as bugs, and does not mistake them for the product being broken.
 */
export const dynamic = "force-dynamic";

export default async function TutorialPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const { state } = await readSetupState(supabase, session.workspaceId);

  return (
    <>
      <PageHeader
        eyebrow="Help"
        title="How this works"
        lede={
          <>
          Nine stages. You do five of them; the product does the rest and asks before anything
          reaches a real person. Each one says what it cannot do as well as what it does — you are
          going to meet those edges either way, and meeting them here is cheaper.
          </>
        }
      />

      <ol className="tour">
        {TOUR_STAGES.map((stage, index) => {
          const status = stageStatus(stage, state);
          return (
            <li key={stage.id} className={`tour-stage is-${status}`}>
              <div className="tour-mark" aria-hidden="true">
                {index + 1}
              </div>
              <div className="stack-2">
                <div className="row">
                  <h2>{stage.title}</h2>
                  {/* The state in a word, not only in the colour of a rail. */}
                  <span
                    className={`pill tiny ${
                      status === "done" ? "positive" : status === "current" ? "warning" : ""
                    }`}
                  >
                    {status === "done" ? "done" : status === "current" ? "you are here" : "ahead"}
                  </span>
                  {stage.youDo === null ? <span className="pill tiny">runs by itself</span> : null}
                </div>

                {stage.youDo ? (
                  <p>
                    <strong>You:</strong> {stage.youDo}
                  </p>
                ) : null}
                <p className="muted">
                  <strong>It:</strong> {stage.weDo}
                </p>
                <p className="small panel">
                  <strong>Worth knowing:</strong> {stage.caveat}
                </p>

                {stage.href ? (
                  <p>
                    <Link className="btn ghost small" href={stage.href}>
                      {status === "current" ? "Go and do this" : "Open"}
                    </Link>
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <section className="card">
        <h2>Still stuck</h2>
        <p className="small muted">
          Raise a ticket and it carries what the product believed at that moment — which step you
          are on, whether LinkedIn is connected, whether the sending loop is running. You do not
          have to go and check any of that first.
        </p>
        <p>
          <Link className="btn secondary small" href="/app/support">
            Raise a ticket
          </Link>
        </p>
      </section>
    </>
  );
}
