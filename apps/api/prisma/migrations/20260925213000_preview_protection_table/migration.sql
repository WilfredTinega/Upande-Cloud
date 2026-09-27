-- Move preview protection off the App row (so app payloads never carry the
-- hash) into its own table. The columns added by the previous migration were
-- never used.
ALTER TABLE "App" DROP COLUMN "previewProtection",
DROP COLUMN "previewAuthUser",
DROP COLUMN "previewAuthHash";

CREATE TABLE "PreviewProtection" (
    "appId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreviewProtection_pkey" PRIMARY KEY ("appId")
);

ALTER TABLE "PreviewProtection" ADD CONSTRAINT "PreviewProtection_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
