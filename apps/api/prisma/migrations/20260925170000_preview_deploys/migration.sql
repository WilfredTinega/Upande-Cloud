-- Preview deploys per branch (own container/router/image; own throwaway DB).
CREATE TABLE "Preview" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'queued',
    "imageRef" TEXT,
    "commitSha" TEXT,
    "lastDeploymentId" TEXT,
    "lastDeployedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "dbName" TEXT,
    "dbRoleName" TEXT,
    "dbPasswordEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Preview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Preview_subdomain_key" ON "Preview"("subdomain");
CREATE UNIQUE INDEX "Preview_appId_branch_key" ON "Preview"("appId", "branch");

ALTER TABLE "Preview" ADD CONSTRAINT "Preview_appId_fkey"
  FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Deployment" ADD COLUMN "previewId" TEXT;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_previewId_fkey"
  FOREIGN KEY ("previewId") REFERENCES "Preview"("id") ON DELETE SET NULL ON UPDATE CASCADE;
