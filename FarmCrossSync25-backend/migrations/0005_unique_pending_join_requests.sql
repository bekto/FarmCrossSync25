-- Ticket 82: at most one active (pending) join request per user per farm.
--
-- The non-unique idx_farm_invites_farm_user (0003) allows several pending rows
-- for the same (farm_id, user_id) when concurrent joins race past the handler's
-- existence check. This partial unique index makes the invariant a database
-- guarantee; the join handler maps its violation to the existing-request
-- result (409 "pending request"). Denied/accepted rows are deliberately NOT
-- covered: a denied user must be able to submit a fresh pending request
-- without reopening the old row.

-- Existing databases may already hold duplicate pending rows from the race;
-- keep the earliest request per (farm, user) so the index creation applies.
DELETE FROM farm_invites
 WHERE status = 'pending'
   AND rowid NOT IN (
     SELECT MIN(rowid)
       FROM farm_invites
      WHERE status = 'pending'
      GROUP BY farm_id, user_id
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_farm_invites_pending_unique
  ON farm_invites(farm_id, user_id)
  WHERE status = 'pending';
