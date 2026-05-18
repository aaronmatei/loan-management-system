
-- Create USERS table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role VARCHAR(20) DEFAULT 'loan_officer',
  phone_number VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create CLIENTS table
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  client_code VARCHAR(20) UNIQUE,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  phone_number VARCHAR(15) NOT NULL,
  email VARCHAR(100),
  id_number VARCHAR(20),
  business_name VARCHAR(100),
  business_type VARCHAR(50),
  address TEXT,
  city VARCHAR(50),
  county VARCHAR(50),
  status VARCHAR(20) DEFAULT 'active',
  kyc_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create LOANS table
CREATE TABLE IF NOT EXISTS loans (
  id SERIAL PRIMARY KEY,
  loan_code VARCHAR(30) UNIQUE,
  client_id INT NOT NULL REFERENCES clients(id),
  principal_amount NUMERIC(12, 2) NOT NULL,
  interest_rate NUMERIC(5, 2) NOT NULL,
  loan_duration_months INT NOT NULL,
  start_date DATE,
  end_date DATE,
  disbursement_date DATE,
  total_amount_due NUMERIC(12, 2),
  total_interest NUMERIC(12, 2),
  status VARCHAR(30) DEFAULT 'active',
  -- Loan application workflow (also in migrations/add_loan_workflow.sql)
  application_date DATE,
  application_source VARCHAR(50) DEFAULT 'walk_in',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMP,
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMP,
  disbursed_by INTEGER REFERENCES users(id),
  disbursed_at TIMESTAMP,
  disbursement_method VARCHAR(30),
  disbursement_reference VARCHAR(100),
  rejected_by INTEGER REFERENCES users(id),
  rejected_at TIMESTAMP,
  rejection_reason TEXT,
  review_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INT REFERENCES users(id)
);

-- Create PAYMENT_SCHEDULES table
CREATE TABLE IF NOT EXISTS payment_schedules (
  id SERIAL PRIMARY KEY,
  loan_id INT NOT NULL REFERENCES loans(id),
  payment_number INT NOT NULL,
  due_date DATE NOT NULL,
  amount_due NUMERIC(12, 2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  amount_paid NUMERIC(12, 2) DEFAULT 0,
  actual_payment_date DATE,
  days_late INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(loan_id, payment_number)
);

-- Create TRANSACTIONS table
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  transaction_code VARCHAR(30) UNIQUE,
  loan_id INT NOT NULL REFERENCES loans(id),
  client_id INT NOT NULL REFERENCES clients(id),
  amount_paid NUMERIC(12, 2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(30),
  payment_reference VARCHAR(100),
  payment_status VARCHAR(20) DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create NOTIFICATIONS table
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  client_id INT REFERENCES clients(id),
  loan_id INT REFERENCES loans(id),
  notification_type VARCHAR(30),
  channel VARCHAR(20),
  recipient VARCHAR(100),
  message TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create DASHBOARD_METRICS table
CREATE TABLE IF NOT EXISTS dashboard_metrics (
  id SERIAL PRIMARY KEY,
  metric_date DATE UNIQUE,
  total_active_loans INT,
  total_loans_amount NUMERIC(14, 2),
  total_amount_paid NUMERIC(14, 2),
  outstanding_balance NUMERIC(14, 2),
  total_overdue_accounts INT,
  collection_rate NUMERIC(5, 2),
  default_rate NUMERIC(5, 2),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create AUDIT_LOGS table
-- NOTE: also mirrored/upgraded by migrations/add_audit_logs.sql for
-- databases created before the rich audit schema existed.
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  user_email VARCHAR(255),
  user_name VARCHAR(255),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INTEGER,
  entity_code VARCHAR(100),
  description TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone_number);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_loans_client ON loans(client_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_loan ON payment_schedules(loan_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_status ON payment_schedules(status);
CREATE INDEX IF NOT EXISTS idx_transactions_loan ON transactions(loan_id);
CREATE INDEX IF NOT EXISTS idx_transactions_client ON transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
-- Create BACKUPS table (also in migrations/add_backups.sql)
CREATE TABLE IF NOT EXISTS backups (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  backup_type VARCHAR(20) DEFAULT 'manual',
  status VARCHAR(20) DEFAULT 'success',
  error_message TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_backups_date ON backups(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at DESC);

-- Insert default admin user (password: Admin@2026)
INSERT INTO users (username, email, password_hash, first_name,last_name, role, is_active)
VALUES (
  'admin',
  'admin@techtsadong.com',
  '$2b$10$lHavBd0Q8HHRc0MiTvzVZu6evrzJuHbF0oRR0EL5yrvQprUpDJ1Oy',
  'Administrator',
  'Administrator',
  'admin',
  true
)
ON CONFLICT (email) DO NOTHING;

-- Insert system settings
CREATE TABLE IF NOT EXISTS system_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(50) UNIQUE NOT NULL,
  setting_value TEXT,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (setting_key, setting_value, description) VALUES
  ('company_name', 'Your Company', 'Company name'),
  ('company_phone', '0700000000', 'Company phone'),
  ('default_interest_rate', '5', 'Default monthly interest rate %'),
  ('max_loan_amount', '500000', 'Maximum loan amount in KES'),
  ('min_loan_amount', '1000', 'Minimum loan amount in KES'),
  ('sms_enabled', 'true', 'Enable SMS notifications'),
  ('email_enabled', 'true', 'Enable email notifications')
ON CONFLICT (setting_key) DO NOTHING;