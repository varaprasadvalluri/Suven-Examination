import dotenv from 'dotenv';

// Local dev convention: .env.local holds real values for testing on your machine and is
// gitignored (see .env.example) — .env stays empty/unused since production (Cloud Run) gets
// its config from injected env vars/secrets, never a file. .env.local wins when both exist.
// dotenv.config() on a missing path is a silent no-op, so this is safe in prod containers
// that ship neither file.
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });
