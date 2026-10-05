import { describe, expect, it } from "vitest";
import { createEmailProvider } from "../src/email.js";
import type { Env } from "../src/config.js";

/**
 * The switch the deployment guide tells operators to use, honoured.
 *
 * With a key already pasted in, `EMAIL_PROVIDER=off` used to send anyway while
 * the Issues tab said email was off.
 */
const keyed = { RESEND_API_KEY: "re_x", EMAIL_FROM: "Nora <nora@example.com>" };

describe("createEmailProvider", () => {
  it("sends nothing when email is switched off, even with a key set", () => {
    expect(createEmailProvider({ ...keyed, EMAIL_PROVIDER: "off" } as Env)).toBeNull();
  });

  it("sends through Resend when asked to and configured", () => {
    expect(createEmailProvider({ ...keyed, EMAIL_PROVIDER: "resend" } as Env)).not.toBeNull();
  });

  it("sends nothing when Resend is chosen but not configured", () => {
    expect(createEmailProvider({ EMAIL_PROVIDER: "resend" } as Env)).toBeNull();
  });
});
