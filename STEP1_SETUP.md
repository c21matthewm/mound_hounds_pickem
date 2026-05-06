# Step 1 Setup

Step 1 is complete in this repository. This file is intentionally short so the setup
instructions do not drift from the main documentation.

Use:

- `README.md` for local setup, Supabase setup, daily development, and app usage.
- `DEPLOY_VERCEL.md` for Vercel, Supabase Auth URLs, production env vars, cron, and deployment.

Quick local check:

```bash
nvm use
npm install
cp .env.local.example .env.local
npm run verify
npm run dev
```

Then open `http://localhost:3000`.
