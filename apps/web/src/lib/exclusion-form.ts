import { isPublicProfileUrl, normalizeExclusionValue, type ExclusionKind } from "@le/shared";

/**
 * What the "Do not contact" form may store, or the sentence saying why not.
 *
 * A person is matched by their profile address and nothing else
 * (`matchExclusion` compares normalised LinkedIn URLs), so a person entered by
 * name was stored as "jane doe", matched nobody, and the screen answered
 * "Added Jane Doe. Nobody here will contact it." That is a promise a colleague
 * made to a customer, written down where nothing would ever read it. A name is
 * refused with the reason rather than accepted into a rule that cannot fire.
 *
 * Every refusal is a sentence. The form used to `return` on an empty value or
 * an unknown kind, which from the other side of the screen is a button that
 * did nothing on the one list where doing nothing is dangerous.
 */
export type ExclusionInput =
  | { ok: true; kind: ExclusionKind; value: string; raw: string }
  | { ok: false; reason: string };

export function readExclusion(kindRaw: unknown, rawValue: unknown): ExclusionInput {
  const kind = String(kindRaw ?? "");
  const raw = String(rawValue ?? "").trim();
  if (kind !== "company" && kind !== "person") {
    return { ok: false, reason: "Pick whether this is a company or a person." };
  }
  if (!raw) {
    return {
      ok: false,
      reason: kind === "person" ? "Paste the person's LinkedIn profile address." : "Type the company's name.",
    };
  }
  if (kind === "person" && !isPublicProfileUrl(raw)) {
    return {
      ok: false,
      reason:
        "A person is matched by their LinkedIn profile address, like linkedin.com/in/jane-doe. A name on its own would match nobody, so it was not added.",
    };
  }
  const value = normalizeExclusionValue(kind, raw);
  if (!value) {
    return { ok: false, reason: "That name has nothing in it to match on. Type the company's name as people write it." };
  }
  return { ok: true, kind, value, raw };
}
