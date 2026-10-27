import { CTA_PLACEHOLDER, PITCH_PLACEHOLDER, renderCta, renderMerge, type MergeValues } from "@le/shared";

/**
 * A stored message as one real person would read it.
 *
 * Copy is stored with its fill-ins (`{{first_name}}`, `{{pitch}}`,
 * `{{cta_link}}`), and screens printed it that way: a business owner reading
 * "Thanks for connecting, {{first_name}}" cannot tell whether that is what
 * goes out. This fills in what is known — the person's own details, the
 * approved offer, the campaign's link — through the same `renderMerge` and
 * `renderCta` the send path uses.
 *
 * What is not known yet stays visible, as rule 29 wants, but in words and
 * marked: "[your offer, once one is approved]" is caught on the review screen
 * exactly as `{{pitch}}` was, and somebody who has never seen a template can
 * read it. Display only: nothing here is ever what is sent.
 */
export function CopyPreview({
  message,
  person,
  pitch,
  link,
  linkLabel = "your link",
}: {
  message: string;
  person?: Partial<MergeValues> | null;
  /** The approved offer line, when there is one. */
  pitch?: string | null;
  /** Where `{{cta_link}}` points, when it is known here. */
  link?: string | null;
  /** What to call the link when it is filled in only at send time. */
  linkLabel?: string;
}) {
  let text = renderMerge(message, person ?? {});
  text = renderCta(text, link);
  if (pitch?.trim()) text = text.split(PITCH_PLACEHOLDER).join(pitch.trim());

  const gaps: Record<string, string> = {
    [PITCH_PLACEHOLDER]: "your offer, once one is approved",
    [CTA_PLACEHOLDER]: linkLabel,
    "{{first_name}}": "their first name",
    "{{last_name}}": "their last name",
    "{{company}}": "their company",
    "{{title}}": "their job title",
    "{{location}}": "where they are",
    "{{rep_name}}": "your name",
  };
  const parts = text.split(/(\{\{\s*[a-z_]+\s*\}\})/gi);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        const key = part.replace(/\s+/g, "").toLowerCase();
        return (
          <mark key={i} className="copy-gap" title={part}>
            {gaps[key] ?? part.replace(/[{}]/g, "").replace(/_/g, " ")}
          </mark>
        );
      })}
    </>
  );
}
