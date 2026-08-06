# Project Guidelines

## To-Do

- [x] `2026-08-06` Add To-Do tracking system to AGENTS.md (track all user requests here)
- [x] `2026-08-06` Decide MERN vs keep PHP/HTML → **DECIDED: migrate to MERN** (Node 24 on G:, XAMPP on G:, karaoke already Node; CSS carries over verbatim so design is preserved)
- [x] `2026-08-06` Build Express + Mongoose backend (`server/`) replacing all PHP logic (auth, songs, uploads, playlists, admin)
- [x] `2026-08-06` Build React + Vite frontend (`client/`) preserving design exactly (CSS/JS split per page)
- [x] `2026-08-06` Port pages with per-page folders: Home, Login, Signup, Dashboard, Playlist, SongDetails, Premium, Profile, Admin, Karaoke (Playlist/SongDetails/Premium kept as static HTML+CSS+JS in `client/public/`, rest are React)
- [x] `2026-08-06` Split all mixed HTML/CSS/JS into separate files (one per language) — done as part of client port
- [x] `2026-08-06` Rename `Abon/`, `Choa/`, `Jannat/` folders → become `Playlist/`, `SongDetails/`, `Premium/` pages
- [x] `2026-08-06` Install MongoDB on G drive (installer saved in E drive) → **MongoDB 8.0.4 on `G:\MongoDB` (zip kept at `E:\Downloads\mongodb-windows-x86_64-8.0.4.zip`); DB seeded via `server/seed.js` from `all_data.sql` data**
- [x] `2026-08-06` Move `Posters/` + `songs/` into `assets/` and fix all paths (fix `Songs/` vs `songs/` bug)
- [x] `2026-08-06` Archive old PHP/HTML code in `legacy/`; sort whole project structure
- [x] `2026-08-06` Keep all `.exe` files in E drive — Mongo installer kept on `E:\Downloads`
- [x] `2026-08-06` Update README.md to match the new MERN structure
- [x] `2026-08-06` Split `karaoke-app/public/index.html` into `index.html` + `style.css` + `script.js` (byte-identical CSS/JS)
- [x] `2026-08-06` Commit MERN migration to git (`a5ba9d8`) — all updated files, archives, and docs
- [x] `2026-08-06` Rename leftover `legacy/Abon`, `legacy/Choa`, `legacy/Jannat` folders → `legacy/Playlist`, `legacy/SongDetails`, `legacy/Premium` (old page archives, best-matching names)
- [x] `2026-08-06` Add step-by-step "How to Run the Website" section to AGENTS.md (MongoDB → API → frontend → browser)
- [x] `2026-08-06` Fix homepage cut-off bug — Dashboard's global `html, body { overflow: hidden; height: 100% }` + Login/Signup/Admin `body { display:flex }` leaked onto all pages (all CSS loads globally); scoped with `body:has()` selectors (Dashboard: `main#mainContainer`, Login: `.login-container`, Admin: `.admin-login-page`), Signup wrapped in `.signup-page` div — superseded by per-page CSS isolation below
- [x] `2026-08-06` Restore exact original design on all pages — all page CSS loaded globally so later pages (Admin.css `.btn`, Dashboard.css `header`/`.logo`, Login/Signup/Profile `.logo`) overrode Home.css (logo/buttons wrong). Replaced static `import './X.css'` with per-page isolation: `import cssRaw from './X.css?raw'` + `useLayoutEffect` injecting `<style data-page-css="X">` into `<head>`, removed on unmount (`Home`, `Login`, `Signup`, `Dashboard`, `Profile`, `Admin`). Reverted the `body:has()` workarounds back to original `html, body` / `body` text. Admin body rule (flex-centering from `admin_login.html`) split so the panel uses normal flow via existing `.admin-login-page`. Aligned Dashboard.css to legacy `user_dashboard.html`. Verified headless via Edge: each route loads ONLY its own page CSS (`/` Home, `/login` Login, `/signup` Signup, `/dashboard` Dashboard, `/profile` Profile, `/admin` Admin); homepage buttons are black text on sky-blue with `padding 8px 20px`/`12px 30px`, header logo 28px left, auth links right, html scrollHeight 3131/overflow visible
- [x] `2026-08-06` Create `RUNNING_AND_ADMIN_GUIDE.md` — standalone doc covering manual run steps (MongoDB → API → frontend → browser, ports, first-time setup, troubleshooting) and full Admin Panel management (credentials, all 7 sections, resetting admin password)
- [x] `2026-08-06` Remove admin credentials from the GitHub repo — seed.js had hardcoded fallback `admin123` and README/guide/AGENTS.md documented it. Now: `ADMIN_PASSWORD` comes from gitignored `server/.env`; if missing, seed generates a random password printed once. Rotated the local admin password + JWT_SECRET in `.env` and re-hashed the admin user in MongoDB; verified `admin123` no longer works and the new password logs in. Docs updated (README, guide, AGENTS.md) with env-based instructions

## How to Run the Website (step by step)

Run all three services in this order (3 terminals). The Vite frontend proxies `/api` and `/assets` to `localhost:5000`.

### Step 1 — Start MongoDB (database)

```powershell
& "G:\MongoDB\bin\mongod.exe" --dbpath "G:\MongoDB\data" --logpath "G:\MongoDB\log\mongod.log" --logappend
```

- Runs on `localhost:27017`. Leave this window open.
- If MongoDB is not installed yet, extract `E:\Downloads\mongodb-windows-x86_64-8.0.4.zip` to `G:\MongoDB` and create the `data` and `log` folders.
- To reset/reseed the DB with the 14 songs + admin user:

```powershell
# in the server/ folder
npm run seed
```

### Step 2 — Start the API backend (Express)

```powershell
cd "D:\Aronno\Works\Melodify - Music Streaming Website\server"
npm install    # first time only
npm run dev
```

- Runs on `http://localhost:5000`. Leave this window open.
- Verify: open `http://localhost:5000/api/health` → should return `{"status":"ok"}`.

### Step 3 — Start the frontend (React + Vite)

```powershell
cd "D:\Aronno\Works\Melodify - Music Streaming Website\client"
npm install    # first time only
npm run dev
```

- Runs on `http://localhost:5173`. Leave this window open.

### Step 4 — Open the website

- Browse to **http://localhost:5173**
- Admin login: email + password come from `server/.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, never hardcoded in the repo) → visit http://localhost:5173/admin
- Normal users: sign up at http://localhost:5173/signup
- Static pages: http://localhost:5173/playlist/, http://localhost:5173/song-details/, http://localhost:5173/premium/
- Karaoke app: open `karaoke-app/` separately (served from its own folder)

### Notes

- If a port is already in use, check `Get-NetTCPConnection -LocalPort <port> -State Listen` and kill the old process first.
- Server logs: `server/server.log`; Vite logs: `client/vite.log`.
- Media lives in `assets/posters/` and `assets/songs/` (MP3s are gitignored — do not delete).

## To-Do Tracking

- Maintain a `## To-Do` list in this file (AGENTS.md).
- **Every time the user gives a new instruction or request, update the To-Do list in AGENTS.md** — add new tasks, mark completed items as `- [x]`, and keep statuses current.
- Each item must start with a timestamp in `YYYY-MM-DD` format: `- [ ] \`2026-08-06\` task description`.
- **Default timestamp**: when adding a new item, always use the most recent timestamp already present in the file unless the user provides a specific time.
- If the user gives a time (e.g. "do what was on the list for 2026-08-10"), use it to filter/follow only the items with that timestamp.
- Keep the list in sync with the actual project state.

## README Maintenance

- **Always update README.md whenever code or project structure changes.**
- Keep the Features, Project Structure, and Getting Started sections in sync with the actual code.
- Update the README in the same commit as the code change (or a commit immediately after).
- If a feature is removed or renamed, remove/update its README entry too.

## Commit Policy — NEVER commit

- `.env` files (any location, any variant: `.env`, `.env.local`, `.env.*` — only `.env.example` allowed)
- API keys, tokens, or secrets (auth tokens, JWT secrets, OAuth client secrets, etc.)
- Database passwords / connection strings containing credentials
- AWS/GCP/Azure credentials or any cloud service-account keys
- Private certificates (`.pem`, `.crt`, `.key`, `.p12`, `.pfx`, `.p8`)
- SSH keys (`id_rsa`, `id_ed25519`, known_hosts, config with keys)
- Customer/personal data (PII, user data dumps)
- Paid datasets you don't have permission to share (e.g. the MP3 files in `assets/songs/` are gitignored for this reason)

**Before every commit:** run `git status` and review `git diff` to confirm no secrets or sensitive files are staged. If something sensitive is committed by mistake, rotate the secret immediately and rewrite history only with explicit user approval.
