-- AlterEnum
BEGIN;
CREATE TYPE "AppType_new" AS ENUM ('static', 'node', 'fullstack', 'nodered');
ALTER TABLE "App" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "App" ALTER COLUMN "type" TYPE "AppType_new" USING ("type"::text::"AppType_new");
ALTER TYPE "AppType" RENAME TO "AppType_old";
ALTER TYPE "AppType_new" RENAME TO "AppType";
DROP TYPE "AppType_old";
ALTER TABLE "App" ALTER COLUMN "type" SET DEFAULT 'static';
COMMIT;

-- DropForeignKey
ALTER TABLE "FrappeApp" DROP CONSTRAINT "FrappeApp_appId_fkey";

-- DropForeignKey
ALTER TABLE "FrappeDatabase" DROP CONSTRAINT "FrappeDatabase_appId_fkey";

-- AlterTable
ALTER TABLE "App" DROP COLUMN "frappeAdminPasswordEnc",
DROP COLUMN "frappeSiteName",
DROP COLUMN "frappeVersion",
DROP COLUMN "frappeVolumeName";

-- DropTable
DROP TABLE "FrappeApp";

-- DropTable
DROP TABLE "FrappeDatabase";

