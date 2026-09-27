-- Password-protected previews (bcrypt hash only, never the password).
ALTER TABLE "App" ADD COLUMN "previewProtection" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "App" ADD COLUMN "previewAuthUser" TEXT;
ALTER TABLE "App" ADD COLUMN "previewAuthHash" TEXT;
