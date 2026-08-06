# 🎵 Melodify — Music Streaming Website

A full-featured music streaming web application with user authentication, a song library with an audio player, playlist support, an admin panel, and a real-time karaoke recorder. Built with the **MERN stack** (MongoDB, Express, React, Node.js) — migrated from the original PHP + MySQL version (archived in `legacy/`).

---

## ✨ Features

### User Side
- **Multi-step sign-up flow** — email → password → profile details (name, DOB, gender, country)
- **Login / Logout** with JWT authentication and bcrypt password hashing
- **Song library** — search by song title or artist, browse a poster grid
- **Full audio player** — play/pause, next/previous, shuffle, repeat, volume control, mute, progress bar
- **Now Playing panel** — song title, artist, genre, duration, release date
- **Upload songs** — any user can add songs with MP3/WAV audio + JPG/PNG poster via a modal form
- **Profile page** — view/edit personal info, change password
- **Playlist page**, **song details page**, **Premium subscription page**

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
| Frontend   | React 18, Vite, React Router, vanilla CSS/JS per page |
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
│   ├── models/                    # User, Song, Playlist, Report, Subscription
│   ├── middleware/                # JWT auth, admin guard, multer upload
│   └── routes/                    # /api/auth, /api/songs, /api/playlists, /api/admin
├── client/                        # React + Vite frontend
│   ├── src/pages/                 # One folder per page (React)
│   │   ├── Home/                  # Landing page
│   │   ├── Login/                 # Login page
│   │   ├── Signup/                # 3-step signup
│   │   ├── Dashboard/             # Music dashboard + player
│   │   ├── Profile/               # User profile
│   │   └── Admin/                 # Admin panel + login
│   ├── src/context/               # Auth context (JWT)
│   ├── src/api/                   # API client
│   └── public/                    # Static pages (HTML + CSS + JS, split)
│       ├── playlist/              # Playlist page (from Abon/)
│       ├── song-details/          # Song details page (from Choa/)
│       └── premium/               # Premium page (from Jannat/)
├── karaoke-app/                   # Real-time karaoke recorder (Node)
│   ├── public/index.html          # Karaoke UI
│   └── server/                    # Express + Socket.IO server
├── assets/                        # Media
│   ├── posters/                   # Song poster images (from Posters/)
│   └── songs/                     # MP3 files (from songs/, NOT in git)
└── legacy/                        # Archived PHP + HTML version (incl. Abon/Choa/Jannat)
```

---

## 🚀 Getting Started

> **Need full step-by-step instructions (including the Admin Panel guide)?** See **[`RUNNING_AND_ADMIN_GUIDE.md`](./RUNNING_AND_ADMIN_GUIDE.md)**.

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

- **Dark theme** — Spotify-style black (#121212) with sky-blue accents (#00b4d8)
- Responsive 3-column layout (Library | Songs | Now Playing)
- Hover animations, smooth transitions, custom scrollbars
- CSS carried over **verbatim** from the original pages — design unchanged

---

## ⚠️ Important Notes

- **Audio files are not tracked in git** — `assets/songs/` (~240 MB of MP3s) is excluded via `.gitignore`. They were restored from `G:\Xampp\htdocs\Projects\Melodify - Music Streaming Website\`.
- The old PHP + MySQL implementation (including `all_data.sql`) is archived in `legacy/` for reference.
- Static pages (`Playlist`, `Song Details`, `Premium`) remain plain HTML + CSS + JS because they have no backend — their design is preserved byte-for-byte.
- This is a university/project build; some admin actions (ban, edit, delete) are demo stubs.

---

## 📄 License

MIT — free to use for learning and personal projects.
