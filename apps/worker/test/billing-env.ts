import { BILLING_ENV_KEYS } from "@le/billing";

/**
 * Sets the process environment the trial limit reads, and returns a function
 * that puts it back.
 *
 * The trial only stops sending on a deployment where somebody could pay, so a
 * test of the limit has to configure Stripe as well as the switch — otherwise
 * it passes because billing is off, and stops testing the limit at all.
 */
export function setBillingEnv(options: { configured: boolean; limit?: string }): () => void {
  const keys = [...BILLING_ENV_KEYS, "TRIAL_LIMIT_ENFORCED"] as const;
  const was = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of BILLING_ENV_KEYS) {
    if (options.configured) process.env[key] = `test_${key.toLowerCase()}`;
    else delete process.env[key];
  }
  if (options.limit === undefined) delete process.env.TRIAL_LIMIT_ENFORCED;
  else process.env.TRIAL_LIMIT_ENFORCED = options.limit;
  return () => {
    for (const key of keys) {
      if (was[key] === undefined) delete process.env[key];
      else process.env[key] = was[key];
    }
  };
}
