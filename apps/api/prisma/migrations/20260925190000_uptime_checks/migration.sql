-- Uptime monitor: one row per probe of a live app.
CREATE TABLE "UptimeCheck" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "up" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "latencyMs" INTEGER,
    "error" TEXT,

    CONSTRAINT "UptimeCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UptimeCheck_appId_checkedAt_idx" ON "UptimeCheck"("appId", "checkedAt");
CREATE INDEX "UptimeCheck_checkedAt_idx" ON "UptimeCheck"("checkedAt");

ALTER TABLE "UptimeCheck" ADD CONSTRAINT "UptimeCheck_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
