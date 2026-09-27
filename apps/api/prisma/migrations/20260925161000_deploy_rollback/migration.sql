-- Rollback: a deployment can redeploy the version of an earlier deployment.
ALTER TABLE "Deployment" ADD COLUMN "rollbackOfId" TEXT;

ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_rollbackOfId_fkey"
  FOREIGN KEY ("rollbackOfId") REFERENCES "Deployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
