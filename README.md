# 🎵 Melodify — Music Streaming Website

A full-featured music streaming web application with user authentication, a song library with a YouTube-powered player, playlist support, an admin panel, and a real-time karaoke recorder. Built with the **MERN stack** (MongoDB, Express, React, Node.js) — migrated from the original PHP + MySQL version (archived in `legacy/`).

---

## ✨ Features

### User Side
- **Multi-step sign-up flow** — email → password → profile details (name, DOB, gender, country)
- **Login / Logout** with JWT authentication and bcrypt password hashing
- **Song library** — search by song title or artist, browse a poster grid
- **Recently Played** — horizontal slider of your latest 20 played songs (per-user history)
- **Full audio player** — play/pause, next/previous, shuffle, repeat, volume control, mute, seekable progress bar with time labels; streams every song via the **YouTube IFrame API** (no local MP3 storage), with an `<audio>` fallback for user-uploaded songs
- **Official posters** — every song's poster comes from its official **YouTube thumbnail** (`img.youtube.com`); local uploads keep their uploaded poster
- **Now Playing panel** — song title, artist, genre, duration, release date
- **Upload songs** — any user can add songs with MP3/WAV audio + JPG/PNG poster via a modal form
- **Profile page** — view/edit personal info, change password
- **Dynamic Playlist page** (`/playlist/:id`) — per-user playlists with real songs, add/remove/rename/delete, search the library to add songs, built-in floating player (YouTube streaming)
- **Dynamic Song Details page** (`/song/:id`) — real song metadata + related tracks (same artist/genre), full footer player with shuffle/repeat/seek/volume
- **Dynamic Premium page** (`/premium`) — live subscription status, subscribe/cancel plans (Individual/Student/Duo) via `/api/subscriptions`

### Admin Side
- Dedicated admin login (demo credentials, see below)
- Dashboard with analytics cards (users, songs, plays, revenue)
- User management (search, edit, ban)
- Music catalog management (add songs)
- Content moderation (resolve reports)
- Subscription & payment management
- System settings

### Karaoke App (`karaoke-app/`)
A real-time karaoke voice recorder with:
- Audio recording & playback
- Real-time lyrics synchronization, audio effects, and volume control via Socket.IO
- Collaborative editing broadcasts across connected clients
- Recording upload API

---

## 🛠️ Tech Stack

| Layer      | Technology                                            |
|------------|-------------------------------------------------------|
| Frontend   | React 18, Vite, React Router, YouTube IFrame API, vanilla CSS/JS per page |
| Backend    | Node.js, Express, Mongoose (JWT + bcrypt)             |
| Database   | MongoDB                                               |
| Karaoke    | Node.js, Express, Socket.IO, Multer                   |
| Versioning | Git + GitHub                                          |

---

## 📁 Project Structure

```
Melodify - Music Streaming Website/
├── server/                        # Express + Mongoose API backend
│   ├── server.js                  # Entry point
│   ├── seed.js                    # Seeds MongoDB from the old SQL data
│   ├── config/db.js               # MongoDB connection
│   ├── models/                    # User, Song, Playlist, Report, Subscription, PlayHistory
│   ├── middleware/                # JWT auth, admin guard, multer upload
│   └── routes/                    # /api/auth, /api/songs, /api/playlists, /api/history, /api/subscriptions, /api/admin
├── client/                        # React + Vite frontend
│   ├── src/pages/                 # One folder per page (React)
│   │   ├── Home/                  # Landing page
│   │   ├── Login/                 # Login page
│   │   ├── Signup/                # 3-step signup
│   │   ├── Dashboard/             # Music dashboard + player
│   │   ├── Profile/               # User profile
│   │   ├── Playlist/              # Playlist detail page (dynamic)
│   │   ├── SongDetails/           # Song details page (dynamic)
│   │   ├── Premium/               # Premium subscription page (dynamic)
│   │   └── Admin/                 # Admin panel + login
│   ├── src/context/               # Auth context (JWT)
│   ├── src/api/                   # API client
│   ├── src/hooks/                 # usePlayer (YouTube + audio fallback player)
│   └── public/                    # Static assets only (no static pages left)
├── karaoke-app/                   # Real-time karaoke recorder (Node)
│   ├── public/index.html          # Karaoke UI
│   └── server/                    # Express + Socket.IO server
├── assets/                        # Media
│   ├── posters/                   # Legacy poster images (uploads + fallbacks)
│   └── songs/                     # Uploaded MP3s (NOT in git; seed songs stream from YouTube instead)
└── legacy/                        # Archived PHP + HTML version (incl. Abon/Choa/Jannat)
```

---

## 🚀 Getting Started

> **Need full step-by-step instructions (including the Admin Panel guide)?** See **[`RUNNING_AND_ADMIN_GUIDE.md`](./RUNNING_AND_ADMIN_GUIDE.md)**.
> **Database setup & MongoDB Compass connection?** See **[`MONGODB_CONNECTION_GUIDE.md`](./MONGODB_CONNECTION_GUIDE.md)**.

### Prerequisites
- [Node.js](https://nodejs.org/) (installed on `G:\NodeJS` on this machine)
- [MongoDB Community Server](https://www.mongodb.com/try/download/community) (installed on `G:\MongoDB` on this machine)

### 1. Start MongoDB
```bash
mongod --dbpath G:\MongoDB\data
```

### 2. Seed the database
```bash
cd server
npm install
npm run seed
```

### 3. Run the API server
```bash
npm run dev        # http://localhost:5000
```

### 4. Run the React frontend
```bash
cd client
npm install
npm run dev        # http://localhost:5173
```

### 5. Run the karaoke app (optional)
```bash
cd karaoke-app/server
npm install
npm start          # http://localhost:3000
```

---

## 🔑 Admin Credentials

The admin password is **never hardcoded** in the codebase. Set it in `server/.env` (gitignored):

```env
ADMIN_EMAIL=admin@melodify.com
ADMIN_PASSWORD=your-strong-password
```

- If `ADMIN_PASSWORD` is missing when seeding, a random password is generated and printed to the console once.
- Then run `npm run seed` in `server/` to create the admin user, and access the panel at `/admin`.
- See [`RUNNING_AND_ADMIN_GUIDE.md`](./RUNNING_AND_ADMIN_GUIDE.md) for the full admin guide.

---

## 🎨 Design

- Homepage layout uses a shared 1170px desktop content width with fluid 24px gutters.
- The homepage navigation is a 60px fixed glass header with a fine blue separator.
- Home/Premium/Studio/Feed links use compact bright labels; Home has an accessible current-page state and violet/blue underline.
- `components/home/Waveform.jsx` supplies a reusable blue/violet SVG brand mark with collision-free gradient IDs.
- **Homepage** — reference-led redesign with page-scoped CSS injected on mount. The injection strips a leading U+FEFF defensively so the root selector, dark color scheme, and theme variables resolve even with BOM-emitting editors.
- Homepage implementation checkpoints are numbered `01/50`–`50/50` on `ehsanul`, after baseline `6a16a8e97e72a52cf563efe32d49c0646238bdb1`. Resume from the latest numbered commit and preserve any uncommitted work.
- **Homepage palette** — near-black/navy surfaces, pale-blue secondary text, and blue/violet accents. Typography and color scope remain local to the homepage.
- Responsive 3-column layout (Library | Songs | Now Playing)
- Hover animations, smooth transitions, custom scrollbars
- Other pages retain their independent page styles.

---

## ⚠️ Important Notes

- **Songs stream from YouTube** — the 14 seeded songs play through the YouTube IFrame API (each has a `youtube_id` + official YouTube thumbnail poster), so no local MP3 files are needed for them. Local files are only used for songs uploaded by users (`assets/songs/uploads/`, not tracked in git).
- **YouTube thumbnails** are fetched from `https://img.youtube.com/vi/<youtube_id>/hqdefault.jpg` at seed time and stored as `poster_url`; the UI falls back to a placeholder if a thumbnail ever fails to load.
- The old PHP + MySQL implementation (including `all_data.sql`) and the former static pages (`playlist/`, `song-details/`, `premium/`) are archived in `legacy/` for reference.
- **All pages are now dynamic React pages** — no dummy/static content remains in the app; Playlist, Song Details, and Premium are fully backed by the API.
- This is a university/project build; some admin actions (ban, edit, delete) are demo stubs.

---

## 📄 License

MIT — free to use for learning and personal projects.
