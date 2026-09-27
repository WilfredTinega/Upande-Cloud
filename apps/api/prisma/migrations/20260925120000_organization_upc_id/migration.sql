-- Organization IDs move from cuid() to a sequential, upper-case "UPC-000123"
-- format. New IDs come from upc_org_id(); existing organizations are renumbered
-- oldest-first. User, Quota, Project and DnsZone follow automatically through
-- their ON UPDATE CASCADE foreign keys; columns without a foreign key are
-- rewritten from the mapping table below.

CREATE SEQUENCE "organization_uid_seq" START 1;

-- Pads to at least 6 digits but never truncates (UPC-1000000 after UPC-999999).
CREATE FUNCTION upc_org_id() RETURNS text
  LANGUAGE sql VOLATILE
  AS $$
    SELECT 'UPC-' || lpad(n::text, greatest(6, length(n::text)), '0')
    FROM nextval('organization_uid_seq') AS n
  $$;

CREATE TEMP TABLE "_org_id_map" ON COMMIT DROP AS
SELECT
  id AS old_id,
  'UPC-' || lpad(rn::text, greatest(6, length(rn::text)), '0') AS new_id
FROM (
  SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS rn
  FROM "Organization"
) ordered;

UPDATE "Organization" o SET id = m.new_id
FROM "_org_id_map" m WHERE o.id = m.old_id;

-- Columns that hold an organization id without a foreign key.
UPDATE "Notification" t SET "organizationId" = m.new_id
FROM "_org_id_map" m WHERE t."organizationId" = m.old_id;

UPDATE "AgentToken" t SET "organizationId" = m.new_id
FROM "_org_id_map" m WHERE t."organizationId" = m.old_id;

UPDATE "AuditLog" t SET target = replace(t.target, m.old_id, m.new_id)
FROM "_org_id_map" m WHERE strpos(t.target, m.old_id) > 0;

UPDATE "AuditLog" t SET metadata = replace(t.metadata::text, m.old_id, m.new_id)::jsonb
FROM "_org_id_map" m WHERE t.metadata IS NOT NULL AND strpos(t.metadata::text, m.old_id) > 0;

-- Continue numbering after the renumbered organizations.
SELECT setval(
  '"organization_uid_seq"',
  greatest((SELECT count(*) FROM "Organization"), 1),
  (SELECT count(*) FROM "Organization") > 0
);

ALTER SEQUENCE "organization_uid_seq" OWNED BY "Organization".id;
ALTER TABLE "Organization" ALTER COLUMN "id" SET DEFAULT upc_org_id();
