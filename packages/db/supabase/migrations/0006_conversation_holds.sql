-- Why a conversation is waiting for a person, not just that it is.
--
-- Without this, sending an approved reply cleared every hold on the
-- conversation — including "the calendar write failed, book this manually".
-- A prospect accepted a time, the calendar rejected the write, the agent sent
-- a cheerful confirmation, and the flag asking someone to book it by hand was
-- wiped by that same send. The meeting existed in nobody's diary and nothing
-- on any screen said so.

alter table conversations
  add column needs_human_kind text check (needs_human_kind in ('reply', 'booking'));

-- Existing holds were all reply holds; nothing else could set one.
update conversations set needs_human_kind = 'reply' where needs_human;
