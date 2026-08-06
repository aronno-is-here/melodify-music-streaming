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
