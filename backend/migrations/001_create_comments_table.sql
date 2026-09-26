-- PRISM Comments Migration Phase 2
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY,
  market_id VARCHAR(128) NOT NULL,
  text VARCHAR(500) NOT NULL,
  author_id VARCHAR(128),
  author_name VARCHAR(128) DEFAULT 'Anonymous User',
  author_avatar TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_market_id ON comments(market_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at DESC);
