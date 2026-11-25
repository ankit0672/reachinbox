-- Email.failedAt: set when a row becomes FAILED, so the "sent" list (SENT +
-- FAILED) can order by when each email finished. Nullable; existing FAILED
-- rows (if any) fall back to the end of that list.
ALTER TABLE "Email" ADD COLUMN "failedAt" TIMESTAMP(3);
