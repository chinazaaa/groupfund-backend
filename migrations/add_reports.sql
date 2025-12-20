-- Migration: Add reports table for reporting groups and members
-- This table stores reports from members and public users

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL for anonymous/public reports
  reported_group_id UUID REFERENCES groups(id) ON DELETE CASCADE, -- NULL if reporting a member
  reported_user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL if reporting a group
  report_type VARCHAR(50) NOT NULL, -- 'group' or 'member'
  reason VARCHAR(255) NOT NULL, -- 'spam', 'inappropriate', 'fraud', 'harassment', 'other'
  description TEXT, -- Detailed description of the issue
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'reviewed', 'resolved', 'dismissed'
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL, -- Admin who reviewed
  reviewed_at TIMESTAMP,
  admin_notes TEXT, -- Admin's notes on the report
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Ensure at least one of group or user is reported
  -- For member reports, both can be set (group provides context)
  -- For group reports, only group_id should be set
  CHECK (
    (reported_group_id IS NOT NULL) OR (reported_user_id IS NOT NULL)
  )
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported_group_id ON reports(reported_group_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user_id ON reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_report_type ON reports(report_type);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);

-- Add comments
COMMENT ON TABLE reports IS 'Stores reports from users about groups or members';
COMMENT ON COLUMN reports.reporter_id IS 'User who made the report. NULL for anonymous/public reports';
COMMENT ON COLUMN reports.reported_group_id IS 'Group being reported. NULL if reporting a member';
COMMENT ON COLUMN reports.reported_user_id IS 'User being reported. NULL if reporting a group';
COMMENT ON COLUMN reports.report_type IS 'Type of report: group or member';
COMMENT ON COLUMN reports.reason IS 'Reason for report: spam, inappropriate, fraud, harassment, other';
COMMENT ON COLUMN reports.status IS 'Status: pending, reviewed, resolved, dismissed';

