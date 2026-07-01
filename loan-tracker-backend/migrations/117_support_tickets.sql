-- Support ticketing: a tenant's staff raise tickets from their console; platform
-- admins triage + reply from the Support inbox. Human code is derived as
-- 'TK-' || lpad(id) in the API (id is stable), so no separate code column.
CREATE TABLE IF NOT EXISTS support_tickets (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL REFERENCES tenants(id),
  subject         varchar(200) NOT NULL,
  priority        varchar(10) NOT NULL DEFAULT 'normal',  -- low | normal | high
  status          varchar(12) NOT NULL DEFAULT 'open',    -- open | pending | resolved | closed
  created_by      integer,
  created_by_name varchar(120),
  assigned_to     integer,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now(),
  last_reply_at   timestamp NOT NULL DEFAULT now(),
  resolved_at     timestamp
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant ON support_tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id          serial PRIMARY KEY,
  ticket_id   integer NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_type varchar(10) NOT NULL,  -- tenant | platform
  author_id   integer,
  author_name varchar(120),
  body        text NOT NULL,
  created_at  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_msgs_ticket ON support_ticket_messages(ticket_id);
