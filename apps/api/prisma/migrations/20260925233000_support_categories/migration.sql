-- Support conversations get a category (Issue / Inquiry / FAQs / Custom) and an
-- immutable, human-readable reference like "ISSUE-0001". Each category has its
-- own sequence; the reference is assigned by a BEFORE INSERT trigger, so
-- concurrent creates can never collide and no code path can skip it.

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('issue', 'inquiry', 'faqs', 'custom');

CREATE SEQUENCE "support_ref_issue_seq" START 1;
CREATE SEQUENCE "support_ref_inquiry_seq" START 1;
CREATE SEQUENCE "support_ref_faqs_seq" START 1;
CREATE SEQUENCE "support_ref_custom_seq" START 1;

-- Pads to at least 4 digits but never truncates (ISSUE-10000 after ISSUE-9999).
CREATE FUNCTION upc_support_reference(cat "SupportCategory") RETURNS text
  LANGUAGE sql VOLATILE
  AS $$
    SELECT upper(cat::text) || '-' || lpad(n::text, greatest(4, length(n::text)), '0')
    FROM nextval(CASE cat
      WHEN 'issue' THEN 'support_ref_issue_seq'
      WHEN 'inquiry' THEN 'support_ref_inquiry_seq'
      WHEN 'faqs' THEN 'support_ref_faqs_seq'
      ELSE 'support_ref_custom_seq'
    END::regclass) AS n
  $$;

-- AlterTable
ALTER TABLE "SupportConversation"
  ADD COLUMN "category" "SupportCategory" NOT NULL DEFAULT 'custom',
  ADD COLUMN "reference" TEXT;

-- Backfill: existing conversations become Custom (their subject is the custom
-- title), numbered oldest-first.
UPDATE "SupportConversation" c
SET "reference" = 'CUSTOM-' || lpad(o.rn::text, greatest(4, length(o.rn::text)), '0')
FROM (
  SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS rn
  FROM "SupportConversation"
) o
WHERE c.id = o.id;

SELECT setval(
  '"support_ref_custom_seq"',
  greatest((SELECT count(*) FROM "SupportConversation"), 1),
  (SELECT count(*) FROM "SupportConversation") > 0
);

ALTER TABLE "SupportConversation" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "SupportConversation" ALTER COLUMN "reference" SET NOT NULL;
-- Placeholder only: the trigger below always replaces it on insert.
ALTER TABLE "SupportConversation" ALTER COLUMN "reference" SET DEFAULT '';

-- Assign the reference on insert; keep category + reference immutable after.
CREATE FUNCTION support_conversation_reference() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      NEW."reference" := upc_support_reference(NEW."category");
    ELSE
      NEW."reference" := OLD."reference";
      NEW."category" := OLD."category";
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER "SupportConversation_reference"
  BEFORE INSERT OR UPDATE ON "SupportConversation"
  FOR EACH ROW EXECUTE FUNCTION support_conversation_reference();

-- CreateIndex
CREATE UNIQUE INDEX "SupportConversation_reference_key" ON "SupportConversation"("reference");

-- CreateIndex
CREATE INDEX "SupportConversation_category_lastMessageAt_idx" ON "SupportConversation"("category", "lastMessageAt");
