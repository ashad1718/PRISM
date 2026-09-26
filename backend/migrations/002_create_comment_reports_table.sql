-- Migration: 002_create_comment_reports_table.sql
-- Description: Create comment_reports table and add status column to comments for admin moderation

ALTER TABLE comments ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'visible';
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);

CREATE TABLE IF NOT EXISTS comment_reports (
  id UUID PRIMARY KEY,
  comment_id VARCHAR(128) NOT NULL,
  reporter_id VARCHAR(128) NOT NULL,
  reason VARCHAR(64) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_comment_reports_comment FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
  CONSTRAINT unique_comment_reporter UNIQUE (comment_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_reports_comment_id ON comment_reports(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_reports_reporter_id ON comment_reports(reporter_id);
