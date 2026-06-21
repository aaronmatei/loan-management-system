-- Welfare documents: shared files (meeting minutes, account statements, the
-- group constitution, reports, etc.). Uploaded by any member or staff; viewable
-- by members, or restricted to officers via `visibility`. Files live in
-- Cloudinary (reusing the KYC upload pipeline); only the URL is stored here.
BEGIN;

CREATE TABLE IF NOT EXISTS welfare_documents (
  id                 serial PRIMARY KEY,
  tenant_id          integer NOT NULL,
  welfare_id         integer NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title              varchar(160) NOT NULL,
  category           varchar(20) NOT NULL DEFAULT 'other',   -- minutes|statement|constitution|report|other
  visibility         varchar(20) NOT NULL DEFAULT 'members', -- members|officers
  file_url           text NOT NULL,
  file_name          varchar(200),
  mime               varchar(100),
  size_bytes         integer,
  meeting_id         integer,                                -- optional link to a meeting (minutes)
  uploaded_by_member integer REFERENCES members(id) ON DELETE SET NULL,
  uploaded_by_user   integer,                                -- staff uploader (users.id)
  uploaded_by_name   varchar(120),                           -- denormalised display name
  created_at         timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_welfare_documents_welfare ON welfare_documents(welfare_id, created_at DESC);

COMMIT;
