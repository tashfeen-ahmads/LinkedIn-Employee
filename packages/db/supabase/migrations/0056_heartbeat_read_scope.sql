-- Members read the worker's own health, never what it saw of other accounts
-- (rule 15, rule 17).
--
-- 0015 let every signed-in person read every heartbeat row on the grounds that
-- the table holds no customer data. It does now: `accounts:observed` carries
-- every connected LinkedIn account's display name and provider id, and
-- `linkedin:connect-failed` names other workspaces' users. Any member could
-- read all of it with the browser's own client.
--
-- A member needs three rows: whether the sending loop is running, which build
-- booted with what queue, and whether reply deliveries arrive. Platform admins
-- keep reading everything, as the console does.

drop policy if exists worker_heartbeats_read on worker_heartbeats;

create policy worker_heartbeats_read on worker_heartbeats
  for select to authenticated
  using (name in ('campaign-tick', 'worker-boot', 'webhook:messages'));

drop policy if exists worker_heartbeats_admin_read on worker_heartbeats;

create policy worker_heartbeats_admin_read on worker_heartbeats
  for select to authenticated
  using (is_platform_admin());
