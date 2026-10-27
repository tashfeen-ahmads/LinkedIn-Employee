/**
 * The old Likes and comments switch, kept working.
 *
 * Every LinkedIn activity is switched in one place now, the LinkedIn activity
 * section of the profile (`/app/profile/activity`). A page left open from
 * before still posts here, with no `setting` field, which the new route reads
 * as this one (`engage_posts`, rule 68), and the answer lands on the new
 * section.
 */
export { POST } from "../../profile/activity/toggle/route";
