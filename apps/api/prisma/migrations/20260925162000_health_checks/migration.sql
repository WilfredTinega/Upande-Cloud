-- Per-app deploy health check (path, per-probe timeout, number of probes).
ALTER TABLE "App"
  ADD COLUMN "healthCheckPath" TEXT,
  ADD COLUMN "healthCheckTimeout" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "healthCheckRetries" INTEGER NOT NULL DEFAULT 10;
