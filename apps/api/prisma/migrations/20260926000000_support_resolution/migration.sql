-- Support resolution flow: admins ask "Is this solved?", a member answers
-- Yes (auto-close, resolution = solved) or No (stays open, unsolved).

-- CreateEnum
CREATE TYPE "SupportMessageKind" AS ENUM ('text', 'resolution_request', 'resolution_answer');

-- CreateEnum
CREATE TYPE "SupportResolution" AS ENUM ('pending', 'solved', 'unsolved');

-- AlterTable (existing messages become kind = text)
ALTER TABLE "SupportMessage"
  ADD COLUMN "kind" "SupportMessageKind" NOT NULL DEFAULT 'text',
  ADD COLUMN "answer" BOOLEAN;

-- AlterTable
ALTER TABLE "SupportConversation"
  ADD COLUMN "resolution" "SupportResolution",
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_resolvedByUserId_fkey"
  FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
