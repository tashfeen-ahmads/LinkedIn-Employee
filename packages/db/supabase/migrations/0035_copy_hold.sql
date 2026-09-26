-- A hold that is not about this conversation.
--
-- `needs_human_kind` had two values and a follow-up held for want of an approved
-- pitch was flagged with the first of them. So a conversation stopped because
-- nobody had written ninety characters of copy appeared in the inbox as a
-- conversation needing a reply — with no draft in it, because there is no draft:
-- the message was never rendered. The rep is shown a row whose only sensible
-- action is on a different screen.
--
-- Worse, `clearHold(conversation, "reply")` matches it. Sending a manual reply
-- therefore clears a hold that was never about replying, while the pitch stays
-- unapproved. The next tick re-holds it, so nothing is permanently lost — but
-- for the rest of that day every screen says the conversation was dealt with.
--
-- Rule 10 already had the principle: holds carry a kind because the two are
-- resolved by different acts. There are three acts, not two. Read and send a
-- draft; put a meeting in a diary; approve a line of copy.
alter table le.conversations drop constraint if exists conversations_needs_human_kind_check;
alter table le.conversations
  add constraint conversations_needs_human_kind_check
  check (needs_human_kind = any (array['reply'::text, 'booking'::text, 'copy'::text]));
