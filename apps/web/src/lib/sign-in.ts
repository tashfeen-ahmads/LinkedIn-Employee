import { emailAliases } from "@le/shared";

/**
 * The addresses a typed email is tried as, in order: exactly what was typed,
 * then its other Proton addresses.
 *
 * Proton delivers name@pm.me and name@proton.me to one inbox, so people use
 * them interchangeably — and a customer set up as …@pm.me who typed …@proton.me
 * was refused with her correct password. The password still decides; this
 * only stops one inbox's two spellings counting as two strangers.
 */
export function signInCandidates(email: string): string[] {
  const typed = email.trim().toLowerCase();
  return [typed, ...emailAliases(typed).filter((alias) => alias !== typed)];
}
