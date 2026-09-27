-- Environment-scoped env vars: all (default, existing rows) | production | preview.
ALTER TABLE "EnvVar" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'all';

DROP INDEX "EnvVar_appId_key_key";

CREATE UNIQUE INDEX "EnvVar_appId_key_scope_key" ON "EnvVar"("appId", "key", "scope");
