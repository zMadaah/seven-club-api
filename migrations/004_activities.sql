-- 004_activities.sql
-- Atividades de corrida/pedal com trajetória GPS armazenada como GEOGRAPHY.

CREATE TABLE activities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  activity_type        VARCHAR(20) NOT NULL, -- run, ride
  started_at           TIMESTAMPTZ NOT NULL,
  ended_at             TIMESTAMPTZ NOT NULL,
  distance_meters      NUMERIC(10,2) NOT NULL,
  duration_seconds     INTEGER NOT NULL,
  avg_pace_sec_per_km  NUMERIC(6,2),
  trajectory           GEOGRAPHY(LineString, 4326) NOT NULL,
  source               VARCHAR(30) NOT NULL DEFAULT 'app',
  status               VARCHAR(20) NOT NULL DEFAULT 'processing', -- processing, validated, flagged, rejected
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_activities_type CHECK (activity_type IN ('run', 'ride'))
);

CREATE INDEX idx_activities_user_id ON activities(user_id);
CREATE INDEX idx_activities_trajectory_gist ON activities USING GIST(trajectory);
CREATE INDEX idx_activities_started_at ON activities(started_at);
CREATE INDEX idx_activities_status ON activities(status);
