-- ============================================================
-- SMS delivery log. Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS sms_logs (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  loan_id INTEGER REFERENCES loans(id),
  phone_number VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  message_type VARCHAR(50),               -- 'payment_received' | 'reminder' | 'overdue_reminder' | 'custom' ...
  status VARCHAR(20) DEFAULT 'sent',      -- 'sent' | 'failed' | 'pending'
  cost DECIMAL(10, 4),
  provider_response JSONB,
  sent_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_client ON sms_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_loan ON sms_logs(loan_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_date ON sms_logs(created_at DESC);
