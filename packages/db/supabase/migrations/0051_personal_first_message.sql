-- The first message after an acceptance, written for the person who accepted
-- (rule 66). Written by the acceptance poll, read by the send path for step 1,
-- and absent means the campaign's step 1 template, exactly as before.
alter table campaign_prospects
  add column if not exists first_message text,
  add column if not exists first_message_prompt_version text;
