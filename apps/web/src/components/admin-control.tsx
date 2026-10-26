import { adminCan, permissionForControl } from "@le/shared";
import { adminControl } from "@/app/admin/actions";
import { currentAdminRole } from "@/lib/admin";
import { SubmitButton } from "./submit-button";
import { ConfirmButton } from "./confirm-button";

/**
 * One operator control: a single button that posts one op to the worker.
 *
 * A form of its own so a row of them sits inline, and every one carries the
 * page to come back to — the worker's sentence about what happened is shown
 * there.
 *
 * `confirm` makes it a two-press button for the controls that cannot be taken
 * back or act on many things at once — clearing failed jobs, resuming every
 * account's outreach. Its text is what the armed button says, so it should name
 * the consequence.
 */
export async function ControlButton({
  op,
  back,
  label,
  pendingLabel = "Working…",
  fields = {},
  tone = "secondary",
  title,
  confirm,
}: {
  op: string;
  back: string;
  label: string;
  pendingLabel?: string;
  fields?: Record<string, string>;
  tone?: "secondary" | "ghost" | "danger" | "primary";
  title?: string;
  /** Arm on the first press, act on the second; the armed button reads this. */
  confirm?: string;
}) {
  const className = `btn small${tone === "primary" ? "" : ` ${tone}`}`;
  // Offered only to a role that may press it. The worker refuses it anyway;
  // this keeps the screen from offering a button that can only say no.
  if (!adminCan(await currentAdminRole(), permissionForControl(op))) {
    return (
      <button type="button" className={`${className} is-locked`} disabled title="Your role cannot do this. Ask an owner.">
        {label}
      </button>
    );
  }
  return (
    <form action={adminControl} className="control-form" title={confirm ? title : undefined}>
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="back" value={back} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {confirm ? (
        <ConfirmButton className={className} confirmLabel={confirm} pendingLabel={pendingLabel}>
          {label}
        </ConfirmButton>
      ) : (
        <SubmitButton className={className} pendingLabel={pendingLabel} title={title}>
          {label}
        </SubmitButton>
      )}
    </form>
  );
}
