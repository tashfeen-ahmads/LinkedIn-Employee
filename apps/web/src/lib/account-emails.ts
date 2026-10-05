import "server-only";
import { callWorker } from "./worker";

/**
 * Asks the worker for the emails that belong to somebody arriving: their
 * welcome, and the operators' note that they signed up (and, once they have a
 * workspace, that they finished onboarding).
 *
 * Called after signup, after an email confirmation and after onboarding.
 * Every email behind it is claimed once per person in `email_sends`, so three
 * calls send each one once — calling from every arrival is what stops a
 * worker blip at the wrong second from losing the welcome for good.
 *
 * Never turned into a failure on screen: email is a notification, and a person
 * who has just signed up must not be shown an error because a welcome was
 * late. The id comes from the session, never from a form.
 */
export async function requestAccountEmails(userId: string): Promise<void> {
  const result = await callWorker("/email/account", { userId }, 5_000);
  if (!result.ok) console.error("account emails were not requested", result.error);
}
