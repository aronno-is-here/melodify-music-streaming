# Project Guidelines

## To-Do

- [x] `2026-09-15` Implement AI checkpoint 09/43: idempotent YouTube catalog upsert service (canonical identity lookup/insert, single-match legacy adoption preserving `_id`, ambiguous/conflicting conflicts, import-managed refresh whitelist, E11000 single recovery, injected clock, no destructive merges) and pass database-free regression tests.
- [x] `2026-09-15` Implement AI checkpoint 08/43: pure YouTube music candidate normalizer (canonical identity, duration/thumbnail/status parsing, provisional topic-channel artist, conservative catalog eligibility, ordered search+details merge, no genre/language/mood inference) and pass database-free regression tests.
- [x] `2026-09-15` Implement AI checkpoint 07/43: server-side bounded YouTube catalog client (fixed host, injected fetch, 9s timeout, sanitized errors, no retries/pagination, no sync/routes/UI) and pass database-free regression tests.
- [x] `2026-09-15` Implement AI checkpoint 06/43: reject access tokens issued before `passwordChangedAt` with a generic 401, preserve 04/43 purpose separation and 05/43 reset security, and pass database-free regression tests.
- [x] `2026-09-15` Implement AI checkpoint 05/43: remove reset-token logging, sanitize reset-route and reset-sensitive global errors, preserve purpose separation, and pass database-free regression tests.
- [x] `2026-09-15` Implement AI checkpoint 04/43: separate access and password-reset JWT purposes, reject cross-purpose and missing-purpose tokens, and pass database-free security/regression tests.
- [x] `2026-09-15` Record standing permission to directly commit and push completed project changes to `aronno-is-here` using configured GitHub authentication.
- [x] `2026-09-15` Implement AI checkpoint 03/43: pure catalog identity helpers, safe partial Song identity/legacy lookup indexes, and database-free regression tests.
- [ ] `2026-09-15` Implement the reference-matched homepage on ehsanul in 50 numbered checkpoints; verify responsive rendering, preserve player architecture, merge without squashing, and verify the existing Vercel production deployment.
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
- [x] `2026-08-06` Dashboard middle column: "Recently Played" horizontal slider (latest 20 played songs per user) added on top, then search, then "Songs" renamed "Recommended Songs". New `PlayHistory` model + `/api/history` routes (POST record, GET latest 20 populated). Seek bar replaced with a native `<input type="range">` styled like the volume slider (always renders) whose track is a `linear-gradient` filled sky-blue up to the thumb position via a `--fill` CSS var — verified via API + headless Edge
- [x] `2026-08-06` **All static pages converted to dynamic React** — no dummy content remains. Playlist/SongDetails/Premium moved from `client/public/` to `client/src/pages/` (designs byte-identical via `?raw` CSS injection). New shared `client/src/hooks/usePlayer.js` (YouTube IFrame + `<audio>` fallback, repeat/shuffle/seek/volume, auto-next, error skip-guard) powers the new pages. Backend: `GET /api/songs/:id`, `GET/PUT /api/playlists/:id`, Playlist model upgraded `songIds` → `items[{songId, addedAt}]` (populated), `Subscription` gains `plan` field + new `/api/subscriptions` routes (`GET /me`, `POST /`, `PUT /cancel`). Pages: **Playlist** (`/playlist/:id`, protected) — real per-user playlists, play-all, row play, remove song, rename, share, delete, live search-and-add from library, floating player; **SongDetails** (`/song/:id`, protected) — real metadata + related tracks (same artist → same genre → rest), footer player w/ shuffle/repeat/seek/volume; **Premium** (`/premium`) — live subscription status, subscribe/cancel Individual/Student/Duo, dynamic trial-end date, auth-aware nav, FAQ accordion. Entry points: song info click → `/song/:id`; Profile Premium link updated. The "My Playlists" button initially added to the Dashboard Library header was later removed at the user's request (playlists stay reachable via `/playlist/:id`; admin gets 2 seeded playlists). Old static pages archived to `legacy/static_pages/`. Verified: build passes, reseeded (2 playlists seeded for admin), API end-to-end (login → playlists populated → song detail → subscribe → /me active)
- [x] `2026-08-06` Dashboard player now uses shared `usePlayer.js` hook — previously used raw `<audio>` with `file_path` which couldn't play seeded YouTube songs; now supports YouTube IFrame API + audio fallback
- [x] `2026-08-06` Extract duplicate `escapeRegex` into `server/utils/escapeRegex.js` — removed from authRoutes, songRoutes, adminRoutes; imported from shared utility
- [x] `2026-08-06` Add pagination to `GET /api/songs` — supports `page` and `limit` query params, returns `total` and `pages` count
- [x] `2026-08-06` Remove non-functional Google OAuth stub buttons from Login and Signup pages
- [x] `2026-08-06` Install karaoke-app `node_modules` — `npm install` in `karaoke-app/server/`
- [x] `2026-08-06` Commit all MERN migration + fixes to git (`df89ce5`) — 52 files changed, includes all dynamic pages, shared player hook, shared utility, pagination, OAuth stub removal
- [x] `2026-08-06` Create `MONGODB_CONNECTION_GUIDE.md` — standalone doc covering: starting MongoDB, how the project connects via `MONGO_URI` in `server/.env`, seeding, connecting MongoDB Compass (step-by-step), what you can manage in the Compass GUI, and troubleshooting table
- [x] `2026-08-06` **YouTube streaming migration** — every seeded song now plays via the YouTube IFrame API instead of local MP3s. Added `youtube_id` to the Song model; seed now stores official YouTube IDs + official thumbnails (`https://img.youtube.com/vi/<ID>/hqdefault.jpg`) as `poster_url`; all 14 IDs verified by fetching each official video's title (e.g. Dukkho Bilash `ECh1rS2ipJw` G Series official, Nisshash `VHz3srJjAV4` Real Energy official, Die With A Smile `Fn6Ul6sYqro` official MV). Fixed seed metadata: Keno Hothat Tumi Ele artist `Romantic`→`Tahsan` + genre `Hindi`→`Bengali`; Nisshash artist `Borbaad`→`G.M. Ashraf` + genre `Rock`→`Bengali`. Dashboard player rewritten: hidden `#yt-player` div + `window.YT` script loader (`onYouTubeIframeAPIReady`), `loadVideoById`/`setVolume`/`seekTo`, 250ms `getCurrentTime` polling, `onStateChange` (PLAYING/PAUSED/ENDED→repeat or next), `onError`→next; shuffle/repeat/volume/mute/seek preserved; `<audio>` kept only as fallback for user-uploaded songs without `youtube_id`. Verified: `npm run build` passes, reseeded DB, API returns `youtube_id` + YouTube `poster_url` for all 14, thumbnails return HTTP 200
- [x] `2026-08-06` **All static pages converted to dynamic React** — no dummy content remains. Playlist/SongDetails/Premium moved from `client/public/` to `client/src/pages/` (designs byte-identical via `?raw` CSS injection). New shared `client/src/hooks/usePlayer.js` (YouTube IFrame + `<audio>` fallback, repeat/shuffle/seek/volume, auto-next, error skip-guard) powers the new pages. Backend: `GET /api/songs/:id`, `GET/PUT /api/playlists/:id`, Playlist model upgraded `songIds` → `items[{songId, addedAt}]` (populated), `Subscription` gains `plan` field + new `/api/subscriptions` routes (`GET /me`, `POST /`, `PUT /cancel`). Pages: **Playlist** (`/playlist/:id`, protected) — real per-user playlists, play-all, row play, remove song, rename, share, delete, live search-and-add from library, floating player; **SongDetails** (`/song/:id`, protected) — real metadata + related tracks (same artist → same genre → rest), footer player w/ shuffle/repeat/seek/volume; **Premium** (`/premium`) — live subscription status, subscribe/cancel Individual/Student/Duo, dynamic trial-end date, auth-aware nav, FAQ accordion. Entry points: song info click → `/song/:id`; Profile Premium link updated. The "My Playlists" button initially added to the Dashboard Library header was later removed at the user's request (playlists stay reachable via `/playlist/:id`; admin gets 2 seeded playlists). Old static pages archived to `legacy/static_pages/`. Verified: build passes, reseeded (2 playlists seeded for admin), API end-to-end (login → playlists populated → song detail → subscribe → /me active)
- [x] `2026-09-15` **Lyrics feature** — Song model with `lyrics` + `chords` fields, admin PATCH route, LyricsChordsPanel with synced lyrics highlighting, LRCLIB proxy
- [x] `2026-09-15` **Synced lyrics from LRCLIB** — LRC parsing, line-by-line highlighting, auto-scroll, fallback search by title+artist+duration
- [x] `2026-09-15` **Romanized Hindi/Bengali lyrics** — Pure JS transliteration for Devanagari and Bengali scripts; non-Latin lyrics automatically converted to romanized text (e.g., "कैसे बताएं" → "kaise bataen"); English lyrics unchanged. Production verified on Vercel for Hindi (Khamoshiyan), Bengali (Keno Hothat Tumi Ele), and English (Comfortably Numb)

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
- Dynamic pages: http://localhost:5173/playlist/:id (protected), http://localhost:5173/song/:id (protected), http://localhost:5173/premium (public)
- Karaoke app: open `karaoke-app/` separately (served from its own folder)

### Notes

- If a port is already in use, check `Get-NetTCPConnection -LocalPort <port> -State Listen` and kill the old process first.
- Server logs: `server/server.log`; Vite logs: `client/vite.log`.
- Media: seed songs stream from YouTube (see `youtube_id` in the Song model); local files under `assets/songs/uploads/` are only user uploads (gitignored — do not delete).

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

## Default GitHub Workflow

- The user authorizes directly committing and pushing completed project changes to `aronno-is-here/melodify-music-streaming` without asking for confirmation each time, unless a later instruction overrides this preference.
- Use configured GitHub authentication for `aronno-is-here`; never store account passwords or tokens in project files or commit them.
- Push the active task branch to its intended remote branch after appropriate verification and review of the changes.

## GitHub Collaborator — Commit as Contributor

- When the user asks to "commit for mimi" or "commit for ehsanul", read the credentials from `.credentials.json` (gitignored).
- **Workflow:** read `.credentials.json` → set user config + remote with token → commit as collaborator → push → clean remote URL.
- The repo is `aronno-is-here/melodify-music-streaming` on GitHub.
- Branches: `mimi` (for mimibintesharif), `ehsanul` (for mmostaba21372-web), `choa` (for choaIslam).

### Branch Workflow for Contributors
1. **Switch to the contributor's branch** (`mimi`, `ehsanul`, or `choa`)
2. **Make the changes** on that branch
3. **Commit** with the contributor's author info
4. **Push** to their branch using their PAT
5. **Merge** the branch into `main` (fast-forward or merge commit)
6. **Push main** to origin
7. **Clean** the remote URL (remove token)

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
