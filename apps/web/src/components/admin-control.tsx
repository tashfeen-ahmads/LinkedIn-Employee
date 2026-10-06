import { adminControl } from "@/app/admin/actions";
import { SubmitButton } from "./submit-button";

/**
 * One operator control: a single button that posts one op to the worker.
 *
 * A form of its own so a row of them sits inline, and every one carries the
 * page to come back to — the worker's sentence about what happened is shown
 * there.
 */
export function ControlButton({
  op,
  back,
  label,
  pendingLabel = "Working…",
  fields = {},
  tone = "secondary",
  title,
}: {
  op: string;
  back: string;
  label: string;
  pendingLabel?: string;
  fields?: Record<string, string>;
  tone?: "secondary" | "ghost" | "danger" | "primary";
  title?: string;
}) {
  return (
    <form action={adminControl} className="control-form">
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="back" value={back} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton
        className={`btn small${tone === "primary" ? "" : ` ${tone}`}`}
        pendingLabel={pendingLabel}
        title={title}
      >
        {label}
      </SubmitButton>
    </form>
  );
}
