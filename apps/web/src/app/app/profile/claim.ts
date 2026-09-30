/**
 * What arriving back from the hosted LinkedIn flow actually established.
 *
 * The page called the worker's claim route, discarded the answer, and
 * redirected with the green notice "LinkedIn is connected." — unconditionally.
 * So a claim the worker refused, or a provider it could not reach at all,
 * produced a page telling the rep they were connected while the row sat at
 * `connecting`, and the next screen they opened said "reauth required". Two
 * screens contradicting each other with the reassuring one arriving first is
 * the report this product spent three days chasing, and it was written into
 * the redirect.
 *
 * Pure and on its own so it can be read and tested, exactly as
 * `describeRepair` next door is: the page's own version of this had no test,
 * which is why an unconditional success survived in it.
 */
export interface ClaimResponse {
  ok: boolean;
  /** `callWorker`'s message, which the worker already wrote for the rep. */
  error?: string;
  data?: { claimed?: boolean; reason?: string } | null;
}

export interface ClaimNotice {
  tone: "notice" | "error";
  message: string;
}

export function describeClaim(claim: ClaimResponse): ClaimNotice {
  if (claim.ok && claim.data?.claimed) {
    return { tone: "notice", message: "LinkedIn is connected." };
  }

  /*
   * Everything else is "not connected", and it says so first.
   *
   * The two unhappy shapes carry different sentences and both are the
   * worker's: a refusal explains which check declined, and a transport or
   * provider failure comes back as `callWorker`'s error — which the worker
   * writes for the rep and deliberately names no vendor and no credential
   * (rule 54). Neither is rewritten here, because a second reading of the
   * same fault is how two screens come to disagree.
   */
  const because = claim.ok
    ? (claim.data?.reason ?? "the account could not be attached.")
    : (claim.error ?? "we could not reach the service that attaches it.");

  return { tone: "error", message: `LinkedIn was not connected: ${because}` };
}
