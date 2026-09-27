-- Deploy history: who/what triggered each deployment, the commit built,
-- timing, failure reason, and a persisted copy of the full build log.

-- CreateEnum
CREATE TYPE "DeploymentTrigger" AS ENUM ('user', 'webhook', 'rollback', 'api_token', 'admin');

-- AlterTable
ALTER TABLE "Deployment"
  ADD COLUMN "trigger" "DeploymentTrigger",
  ADD COLUMN "triggeredByUserId" TEXT,
  ADD COLUMN "deployTokenId" TEXT,
  ADD COLUMN "triggerDetail" TEXT,
  ADD COLUMN "commitSha" TEXT,
  ADD COLUMN "commitMessage" TEXT,
  ADD COLUMN "forceClean" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "finishedAt" TIMESTAMP(3),
  ADD COLUMN "errorReason" TEXT;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_triggeredByUserId_fkey"
  FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "DeploymentLog" (
    "deploymentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentLog_pkey" PRIMARY KEY ("deploymentId")
);

-- AddForeignKey
ALTER TABLE "DeploymentLog" ADD CONSTRAINT "DeploymentLog_deploymentId_fkey"
  FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
