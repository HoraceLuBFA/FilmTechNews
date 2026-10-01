-- Aggregate only: no visitor identifiers, page paths or individual visit records.
CREATE TABLE site_visits (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  total bigint NOT NULL DEFAULT 0 CHECK (total >= 0),
  started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO site_visits (singleton) VALUES (true);
