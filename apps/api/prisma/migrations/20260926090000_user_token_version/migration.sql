-- Session generation: bumped on password change/reset to revoke older JWTs.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
