-- Email.claimedAt: set by the worker's atomic claim. Nullable, so existing
-- rows need no backfill; reconcile treats a PROCESSING row with no claimedAt
-- (only possible for rows claimed before this column existed) as stale.
ALTER TABLE "Email" ADD COLUMN "claimedAt" TIMESTAMP(3);
