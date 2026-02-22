# Step 1 Setup

Step 1 is already implemented in this repository.

- Next.js app scaffold exists in `src/`
- Supabase packages are installed
- Supabase schema exists in `supabase/schema.sql`
- Environment template exists in `.env.local.example`

## Environment variables

```bash
cp .env.local.example .env.local
```

Set values from Supabase `Project Settings -> API`.

## Local verification

```bash
npm install
npm run lint
npm run build
npm run dev
```

`npm run dev` should start at `http://localhost:3000`.

## Supabase schema

Open Supabase SQL Editor (web dashboard) and run:

`supabase/schema.sql`

## Make first admin user

After your account signs up:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');
```

## Note on `.venv`

This is a Node/Next.js app, so `.venv` is not required for runtime. It can exist in the repo without affecting the app.
