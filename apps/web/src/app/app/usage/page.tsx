import { redirect } from "next/navigation";

/**
 * The old route, kept working — and no longer pointing at a section.
 *
 * What the agents cost is our margin, not the customer's bill. A rep pays a
 * seat price and what they owe does not move with it, so a token count on
 * their dashboard is a number they cannot act on, cannot change, and will
 * reasonably read as something they are being charged for. It belongs in the
 * operator console, where somebody can do something about it.
 *
 * The redirect stays because links, bookmarks and one email still point here,
 * and it aims at the overview rather than `#spend`, which no longer exists —
 * an anchor to a removed section scrolls nowhere and looks like a page that
 * failed to load.
 */
export default async function UsagePage() {
  redirect("/app");
}
