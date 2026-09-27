-- Custom domains: platform-hosted DNS shortcut + persisted verification detail.
ALTER TABLE "CustomDomain" ADD COLUMN "dnsZoneName" TEXT;
ALTER TABLE "CustomDomain" ADD COLUMN "autoRecordType" TEXT;
ALTER TABLE "CustomDomain" ADD COLUMN "autoRecordValue" TEXT;
ALTER TABLE "CustomDomain" ADD COLUMN "lastCheck" JSONB;
