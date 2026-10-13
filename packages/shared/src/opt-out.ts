import { OPT_OUT_PHRASES } from "./constants.js";

/** Every apostrophe-like mark a phone, word processor or keyboard layout types. */
const APOSTROPHES = /[‘’‚‛′ʼ`´]/g;
const QUOTES = /[“”„‟″]/g;
/** Zero-width spaces and joiners, which split a phrase without showing. */
const INVISIBLE = /[​-‍⁠﻿]/g;

/**
 * A message as the opt-out list reads it (rule 7).
 *
 * The phrase list is compared as text, and phones do not type the text it
 * holds: iOS and macOS turn ' into ’ by default, so "don’t contact me" from an
 * iPhone never contained "don't contact". Compatibility forms (full-width
 * letters, ligatures) fold to their plain spelling, every kind of apostrophe
 * and quote becomes the straight one, invisible joiners go, and any run of
 * whitespace — a line break, a no-break space — is one space. Every
 * comparison against `OPT_OUT_PHRASES` goes through this, so the screen that
 * demonstrates the check and the check itself cannot disagree.
 */
export function normalizeForOptOut(message: string): string {
  return (
    message
      // Quotes before NFKC: it decomposes the acute accent (´) into a space
      // and a combining mark, which would split "don´t" into two words.
      .replace(APOSTROPHES, "'")
      .replace(QUOTES, '"')
      .normalize("NFKC")
      .replace(INVISIBLE, "")
      .replace(/\s+/g, " ")
      .toLowerCase()
  );
}

/** The first opt-out phrase a message contains, or null. */
export function findOptOutPhrase(message: string): string | null {
  const normalized = normalizeForOptOut(message);
  return OPT_OUT_PHRASES.find((phrase) => normalized.includes(phrase)) ?? null;
}
