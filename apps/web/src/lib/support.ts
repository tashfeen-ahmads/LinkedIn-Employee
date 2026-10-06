// The one reading of a ticket's captured context lives in @le/shared, because the
// worker's support assistant reads it too — two readings drift.
export { describeTicketContext, type TicketContext } from "@le/shared";
