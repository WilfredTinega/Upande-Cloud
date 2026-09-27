-- "Sign in with GitHub": link a platform user to a GitHub user id.
ALTER TABLE "User" ADD COLUMN "githubId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");
