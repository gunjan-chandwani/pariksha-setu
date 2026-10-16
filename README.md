# Pariksha Setu — MRU Question Bank & Examination Paper Portal

A deployable Node.js + Express + Supabase package built from the supplied MRU portal prototype. It keeps the existing responsive role-specific interface and adds server-side persistence so data can be shared across browsers instead of relying only on `localStorage`.

## Included
- Responsive portal UI with Faculty, COE and Moderator workspaces.
- Question-bank studio, course/outcome mappings, paper builder, two-year repeat screening against available history, moderation queue, selection register, analytics and CSV/JSON exports.
- Express backend with login sessions and `/api/health`, `/api/login`, `/api/state` routes.
- Supabase PostgreSQL JSON state persistence (`supabase/schema.sql`).
- Render deployment manifest (`render.yaml`).

## 1. Configure Supabase
1. Create a Supabase project.
2. Open **SQL Editor**, paste and run `supabase/schema.sql`.
3. In **Project Settings → API**, copy the Project URL and the **service_role** key. The service-role key is secret: enter it only as a server environment variable, never in `public/index.html` or GitHub.

## 2. Deploy to Render
1. Upload this folder's files to a new GitHub repository (keep `package.json`, `server.js`, `render.yaml`, `public/`, and `supabase/` at repository root).
2. In Render, create a **Web Service** from the repository. Build command: `npm install`; start command: `npm start`.
3. Add environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET` (long random secret), and `DEMO_PASSWORD` (temporary demo password).
4. Deploy and open `https://YOUR-SERVICE.onrender.com/api/health`. Expected response: `{"ok":true,"database":"connected"}`.

## 3. Demo sign-in
For initial evaluation only, the server accepts these seeded demo accounts. All use the value configured in `DEMO_PASSWORD` (default `demo123`):
- Faculty — `faculty@mru.edu.in`
- COE — `coe@mru.edu.in`
- Moderator — `moderator@mru.edu.in`

## Local run
```bash
npm install
# Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SESSION_SECRET and DEMO_PASSWORD in your shell
npm start
```
Then open `http://localhost:3000`.

## Important production-readiness note
This is a **deployable workflow prototype**, not yet a certified examination system. The inherited interface stores the workflow as one shared JSON document, which is suitable for initial evaluation but not ideal for concurrent multi-user editing or high-stakes auditability. The current login is a temporary demo-account mechanism, not institutional SSO or Supabase Auth. Before real examination use, implement institutional identity/SSO, per-action server-side role authorization, normalized relational tables, immutable/versioned audit records, concurrency-safe finalization, backups, file storage, and independent security testing. Similarity checks are advisory heuristics and require review. The sample datesheet, question banks and paper records are demo data and must be replaced with authorized MRU records. Do not use demo credentials or demo data for live confidential papers.

## Persistence behavior
On login, the app attempts to load the shared state from Supabase; subsequent saves are sent to the backend. If the backend is unreachable, the UI falls back to the browser's local copy and warns in the browser console, so verify `/api/health` before evaluating persistence. The initial seed data is illustrative and must not be treated as an official datesheet or approved blueprint.
