CREATE TABLE IF NOT EXISTS settings (
  id               INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  event_name       TEXT NOT NULL DEFAULT 'BIMTEK Revitalisasi SD',
  venue_name       TEXT NOT NULL DEFAULT '',
  venue_lat        DOUBLE PRECISION,
  venue_lng        DOUBLE PRECISION,
  radius_m         INT NOT NULL DEFAULT 150,
  max_accuracy_m   INT NOT NULL DEFAULT 100,
  require_venue_code BOOLEAN NOT NULL DEFAULT FALSE,
  venue_secret     TEXT NOT NULL
);
INSERT INTO settings (id, venue_secret)
VALUES (1, md5(random()::text || clock_timestamp()::text))
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS people (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('peserta','panitia')),
  institution TEXT,
  position    TEXT,
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS people_code_uq ON people (lower(code));

CREATE TABLE IF NOT EXISTS sessions (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('peserta','panitia','semua')),
  type       TEXT NOT NULL DEFAULT 'masuk' CHECK (type IN ('masuk','pulang')),
  starts_at  TIMESTAMPTZ NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS attendance (
  id          SERIAL PRIMARY KEY,
  person_id   INT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  session_id  INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  photo_path  TEXT NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  accuracy_m  DOUBLE PRECISION NOT NULL,
  distance_m  DOUBLE PRECISION NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('valid','review','ditolak')),
  risk_score  INT NOT NULL DEFAULT 0,
  flags       JSONB NOT NULL DEFAULT '[]',
  samples     JSONB,
  device_id   TEXT,
  ip          TEXT,
  user_agent  TEXT,
  client_time TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (person_id, session_id)
);
CREATE INDEX IF NOT EXISTS attendance_session_idx ON attendance (session_id);
CREATE INDEX IF NOT EXISTS attendance_device_idx ON attendance (session_id, device_id);

-- Percobaan absen yang ditolak otomatis (di luar radius, akurasi buruk, dll.)
CREATE TABLE IF NOT EXISTS attempt_logs (
  id          SERIAL PRIMARY KEY,
  person_id   INT REFERENCES people(id) ON DELETE CASCADE,
  session_id  INT REFERENCES sessions(id) ON DELETE CASCADE,
  reasons     JSONB NOT NULL,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  accuracy_m  DOUBLE PRECISION,
  distance_m  DOUBLE PRECISION,
  device_id   TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Multi venue (migrasi aman dijalankan berulang) =====
ALTER TABLE settings ADD COLUMN IF NOT EXISTS organizer   TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS event_dates TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS venues (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL DEFAULT '',
  lat         DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_m    INT NOT NULL DEFAULT 150 CHECK (radius_m >= 10),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  code_secret TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pindahkan venue tunggal versi lama (di tabel settings) menjadi venue pertama
INSERT INTO venues (name, lat, lng, radius_m, code_secret)
SELECT COALESCE(NULLIF(venue_name, ''), 'Venue Utama'), venue_lat, venue_lng, radius_m, venue_secret
FROM settings
WHERE venue_lat IS NOT NULL AND venue_lng IS NOT NULL AND NOT EXISTS (SELECT 1 FROM venues);

-- Peserta/panitia boleh dikunci ke satu venue (NULL = venue mana saja)
ALTER TABLE people ADD COLUMN IF NOT EXISTS venue_id INT REFERENCES venues(id) ON DELETE SET NULL;
-- Sesi boleh dibatasi ke beberapa venue (NULL/kosong = semua venue aktif)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS venue_ids INT[];
ALTER TABLE attendance   ADD COLUMN IF NOT EXISTS venue_id INT REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE attempt_logs ADD COLUMN IF NOT EXISTS venue_id INT REFERENCES venues(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS attendance_venue_idx ON attendance (session_id, venue_id);

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

-- Supabase mengekspos skema public lewat REST API (PostgREST).
-- Aktifkan RLS tanpa policy agar tabel TIDAK bisa diakses dengan anon key;
-- server tetap bisa akses karena terhubung sebagai pemilik tabel (postgres).
ALTER TABLE settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE people       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempt_logs ENABLE ROW LEVEL SECURITY;
