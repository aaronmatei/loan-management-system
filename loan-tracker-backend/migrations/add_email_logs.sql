-- ============================================================
-- Email delivery log. Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_logs (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  loan_id INTEGER REFERENCES loans(id),
  recipient_email VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  message_type VARCHAR(50),               -- 'payment_received' | 'overdue_reminder' | 'statement' | 'loan_agreement' | 'custom' ...
  has_attachment BOOLEAN DEFAULT FALSE,
  attachment_name VARCHAR(255),
  status VARCHAR(20) DEFAULT 'sent',      -- 'sent' | 'failed' | 'pending'
  provider_response JSONB,
  sent_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_client ON email_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_loan ON email_logs(loan_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_date ON email_logs(created_at DESC);
