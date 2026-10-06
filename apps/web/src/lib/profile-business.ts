import { checkCtaUrl } from "@le/shared";

/**
 * The business half of the profile form: what onboarding asked first.
 *
 * Pure, so the rules are tested without a request. A company name is required
 * (it is what the workspace is called everywhere); the two addresses are
 * optional but, when given, must be real web addresses, because Sage fetches
 * them; the description is free text with a ceiling.
 */
export const COMPANY_NAME_MAX = 120;
export const BUSINESS_DESCRIPTION_MAX = 2000;

export type BusinessForm =
  | { ok: true; companyName: string; websiteUrl: string | null; linkedinCompanyUrl: string | null; description: string | null }
  | { ok: false; reason: string };

export function readBusinessForm(form: { get(name: string): unknown }): BusinessForm {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const companyName = text("companyName");
  if (!companyName) return { ok: false, reason: "Your company needs a name." };
  if (companyName.length > COMPANY_NAME_MAX) {
    return { ok: false, reason: `A company name is at most ${COMPANY_NAME_MAX} characters.` };
  }

  const address = (name: string, label: string): { ok: true; url: string | null } | { ok: false; reason: string } => {
    const raw = text(name);
    if (!raw) return { ok: true, url: null };
    const checked = checkCtaUrl(raw);
    return checked.ok ? { ok: true, url: checked.url } : { ok: false, reason: `${label}: ${checked.reason}` };
  };
  const website = address("websiteUrl", "Website");
  if (!website.ok) return website;
  const linkedin = address("linkedinCompanyUrl", "LinkedIn company page");
  if (!linkedin.ok) return linkedin;

  const description = text("description");
  if (description.length > BUSINESS_DESCRIPTION_MAX) {
    return { ok: false, reason: `The description is at most ${BUSINESS_DESCRIPTION_MAX} characters.` };
  }
  return {
    ok: true,
    companyName,
    websiteUrl: website.url,
    linkedinCompanyUrl: linkedin.url,
    description: description || null,
  };
}
