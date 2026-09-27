-- GitHub PR integration: per-app toggles + the PR comment tracked per preview.
ALTER TABLE "App" ADD COLUMN "githubCommitStatus" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "App" ADD COLUMN "githubPrComments" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Preview" ADD COLUMN "githubPrNumber" INTEGER;
ALTER TABLE "Preview" ADD COLUMN "githubCommentId" TEXT;
