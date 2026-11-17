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
ALTER TABLE settings ADD COLUMN IF NOT EXISTS one_official_session_per_day BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_test BOOLEAN;
UPDATE sessions SET is_test = concat_ws(' ', name, type) ~* '(^|[^[:alnum:]])(test|tes|uji[[:space:]]+coba)([^[:alnum:]]|$)'
WHERE is_test IS NULL;
ALTER TABLE sessions ALTER COLUMN is_test SET DEFAULT FALSE, ALTER COLUMN is_test SET NOT NULL;

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

-- ===== Akun LO per venue =====
CREATE TABLE IF NOT EXISTS lo_accounts (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  venue_id      INT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lo_accounts_username_uq ON lo_accounts (lower(username));
CREATE INDEX IF NOT EXISTS attempt_logs_session_venue_idx ON attempt_logs (session_id, venue_id);
ALTER TABLE lo_accounts ENABLE ROW LEVEL SECURITY;

-- ===== Jenis sesi bebas (bukan hanya masuk/pulang), mis. "Cek acak 1" =====
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_type_check;

-- ===== Data pemetaan sekolah (Bendahara & Pengawas) =====
ALTER TABLE people ADD COLUMN IF NOT EXISTS region          TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS ruangan         TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS npsn            TEXT;  -- pengawas: bisa beberapa, dipisah "; "
ALTER TABLE people ADD COLUMN IF NOT EXISTS provinsi        TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS kab_kota        TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS ptn             TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS koor_pelaporan  TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS fasil_pelaporan TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS peringkat       TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS notes           TEXT;
CREATE INDEX IF NOT EXISTS people_role_idx ON people (role);

-- ===== QR absen per orang (dipindai LO/panitia) =====
ALTER TABLE people ADD COLUMN IF NOT EXISTS qr_token TEXT;
ALTER TABLE people ALTER COLUMN qr_token SET DEFAULT md5(random()::text || clock_timestamp()::text);
UPDATE people SET qr_token = md5(random()::text || clock_timestamp()::text || id::text) WHERE qr_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS people_qr_uq ON people (qr_token);
-- absen lewat QR tidak punya foto & GPS peserta
ALTER TABLE attendance ALTER COLUMN photo_path DROP NOT NULL;
ALTER TABLE attendance ALTER COLUMN lat        DROP NOT NULL;
ALTER TABLE attendance ALTER COLUMN lng        DROP NOT NULL;
ALTER TABLE attendance ALTER COLUMN accuracy_m DROP NOT NULL;
ALTER TABLE attendance ALTER COLUMN distance_m DROP NOT NULL;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS method     TEXT NOT NULL DEFAULT 'selfie';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS scanned_by TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS participant_note TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS photo_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check,
  ADD CONSTRAINT attendance_status_check CHECK (status IN ('valid','review','ditolak','berhalangan'));

-- Salinan pembagian tugas dari Excel, terpisah dari data absensi.
CREATE TABLE IF NOT EXISTS assignment_roster (
  id INT PRIMARY KEY CHECK (id = 1),
  data JSONB NOT NULL
);
ALTER TABLE assignment_roster ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS school_reporting (
  npsn TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('belum_kirim', 'menunggu_reviu', 'ditolak', 'diterima')),
  submitted_on DATE,
  progress NUMERIC CHECK (progress BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE school_reporting ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS school_progress_report (
  npsn TEXT PRIMARY KEY,
  progress NUMERIC CHECK (progress BETWEEN 0 AND 100),
  filled BOOLEAN NOT NULL,
  sent BOOLEAN NOT NULL,
  reviewed BOOLEAN NOT NULL,
  indicators JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE school_progress_report ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS venue_arrival_recap (
  venue_id INT PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  marks JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE venue_arrival_recap ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_arrival_recap ADD COLUMN IF NOT EXISTS detail_rows JSONB;
ALTER TABLE venue_arrival_recap ADD COLUMN IF NOT EXISTS source_summary JSONB;
ALTER TABLE venue_arrival_recap ADD COLUMN IF NOT EXISTS representatives JSONB NOT NULL DEFAULT '{}';

ALTER TABLE people ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE people ADD COLUMN IF NOT EXISTS roster_added_at TIMESTAMPTZ;
