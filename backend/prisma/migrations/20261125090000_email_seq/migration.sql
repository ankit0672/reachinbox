-- Email.seq: 0-based lead position within its campaign (ordering key is
-- scheduledAt, seq, id). Added with a temporary default so existing rows are
-- valid, backfilled per campaign in their current order, then the default is
-- dropped so every new row must set it explicitly.
ALTER TABLE "Email" ADD COLUMN "seq" INTEGER NOT NULL DEFAULT 0;

UPDATE "Email" e
SET "seq" = ranked.seq
FROM (
  SELECT id,
         (ROW_NUMBER() OVER (PARTITION BY "campaignId" ORDER BY "scheduledAt", "createdAt", id) - 1)::int AS seq
  FROM "Email"
) AS ranked
WHERE e.id = ranked.id;

ALTER TABLE "Email" ALTER COLUMN "seq" DROP DEFAULT;

CREATE UNIQUE INDEX "Email_campaignId_seq_key" ON "Email"("campaignId", "seq");
CREATE INDEX "Email_senderId_scheduledAt_idx" ON "Email"("senderId", "scheduledAt");
