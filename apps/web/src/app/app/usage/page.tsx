import { redirect } from "next/navigation";

/**
 * The old route, kept working.
 *
 * Agent spend is a section of the overview now. See the note in
 * `usage-section.tsx`.
 */
export default async function UsagePage() {
  redirect("/app#spend");
}
