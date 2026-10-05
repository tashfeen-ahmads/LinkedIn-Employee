import { LogoMark } from "./logo";
import { type MemberKey, TEAM_MEMBER } from "@/lib/team";

/**
 * A teammate's mark: their initial on a plate of their own colour.
 *
 * Initials rather than faces, for the reason the app's own avatar is initials:
 * a drawn face on an AI teammate is a claim about a person who does not exist,
 * and the plate is the same rounded square as the logo, so the five read as one
 * family. NORA wears the logo itself — she *is* the product.
 *
 * The colours are tokens (`--crew-*`), set separately for light and dark, so
 * the letter keeps its contrast on both grounds (rule 38: a hex in a component
 * is a colour that only works on one ground).
 */
export function TeamAvatar({
  member,
  size = "md",
}: {
  member: MemberKey | "lead";
  size?: "sm" | "md" | "lg";
}) {
  if (member === "lead") {
    const px = size === "lg" ? 56 : size === "sm" ? 28 : 40;
    return (
      <span className={`crew-avatar crew-lead is-${size}`} aria-hidden="true">
        <LogoMark size={px} />
      </span>
    );
  }
  const person = TEAM_MEMBER[member];
  return (
    <span className={`crew-avatar crew-${member} is-${size}`} aria-hidden="true">
      {person.name.charAt(0)}
    </span>
  );
}
