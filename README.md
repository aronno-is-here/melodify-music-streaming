# 🎵 Melodify — Music Streaming Website

A full-featured music streaming web application with user authentication, a song library with an audio player, playlist support, an admin panel, and a bonus real-time karaoke recorder. Built with PHP + MySQL on the backend and vanilla HTML/CSS/JavaScript on the frontend, with a Node.js (Express + Socket.IO) karaoke server.

---

## ✨ Features

### User Side
- **Multi-step sign-up flow** — email → password → profile details (name, DOB, gender, country)
- **Login / Logout** with PHP sessions and `password_hash()`/`password_verify()` security
- **Song library** — search by song title or artist, browse a poster grid
- **Full audio player** — play/pause, next/previous, shuffle, repeat, volume control, mute, progress bar
- **Now Playing panel** — song title, artist, genre, duration, release date
- **Upload songs** — any user can add songs with MP3/WAV audio + JPG/PNG poster via a modal form
- **Profile page**, **playlist page**, **song details page**, **Premium subscription page**

### Admin Side (`admin_panel.php`)
- Dedicated admin login (demo credentials, see below)
- Dashboard with analytics cards (users, songs, plays, revenue)
- User management (search, edit, ban)
- Music catalog management (add songs, edit, delete)
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

| Layer      | Technology                                   |
|------------|----------------------------------------------|
| Frontend   | HTML5, CSS3, vanilla JavaScript, Font Awesome, Google Fonts |
| Backend    | PHP 8 (PDO), MySQL                            |
| Server     | XAMPP / Apache (or any PHP server)            |
| Karaoke    | Node.js, Express, Socket.IO, Multer           |
| Versioning | Git + GitHub                                  |

---

## 📁 Project Structure

```
Melodify - Music Streaming Website/
├── index.php                    # Main dashboard (requires login)
├── home_page.html               # Landing page
├── login.php                    # Login handler + page
├── login_page.html              # Login page (static)
├── signup_page.html             # Sign-up page (static)
├── signup.php                   # Sign-up handler (step 1: email)
├── password_page.php            # Step 2: create password
├── password.php                 # Password validation + hashing
├── profile_making_page.php      # Step 3: profile details
├── profile_making.php           # User creation handler
├── logout.php                   # Session destroy
├── fetch_songs.php              # JSON API — returns song list
├── upload_song.php              # JSON API — handles song/poster uploads
├── admin_panel.php              # Admin dashboard (self-contained)
├── admin_login.html             # Admin login page (static)
├── admin_dashboard.html         # Admin dashboard (static variant)
├── user_dashboard.html          # User dashboard (main)
├── user_dashboard_chords.html   # Dashboard variant (chords view)
├── user_dashboard_lyrics.html   # Dashboard variant (lyrics view)
├── profile.html                 # User profile page
├── all_data.sql                 # Database schema + seed data
├── Abon/playlist.html           # Playlist page
├── Choa/song_details.html       # Song details page
├── Jannat/premium.html          # Premium subscription page
├── karaoke-app/
│   ├── public/index.html        # Karaoke UI
│   └── server/                  # Express + Socket.IO server
├── Posters/                     # Song poster images
└── songs/                       # MP3 files (NOT in git — see below)
```

---

## 🚀 Getting Started

### Prerequisites
- [XAMPP](https://www.apachefriends.org/) (PHP 8+, MySQL, Apache) — or any PHP + MySQL setup
- [Node.js](https://nodejs.org/) (only for the karaoke app)

### 1. Set up the database
1. Start **Apache** and **MySQL** in XAMPP Control Panel
2. Open **phpMyAdmin** → Import → choose `all_data.sql`
3. This creates the `melodify_db` database with `users`, `songs`, `playlists`, and `playlist_songs` tables, seeded with sample songs

### 2. Run the website
1. Copy the project folder into `C:\xampp\htdocs\`
2. Visit `http://localhost/Melodify - Music Streaming Website/` (or `index.php`)
3. Sign up a new account and log in

> **Note:** database connection details (`localhost`, `root`, empty password) are defined at the top of each PHP file — adjust if your MySQL uses a password.

### 3. Run the karaoke app (optional)
```bash
cd karaoke-app/server
npm install
npm start
```
Then open `http://localhost:3000`.

---

## 🔑 Demo Admin Credentials

| Field    | Value                |
|----------|----------------------|
| Email    | `admin@melodify.com` |
| Password | `admin123`           |

Access the admin panel at `admin_panel.php`.

---

## 🎨 Design

- **Dark theme** — Spotify-style black (#121212) with sky-blue accents (#00b4d8)
- Responsive 3-column layout (Library | Songs | Now Playing)
- Hover animations, smooth transitions, custom scrollbars

---

## ⚠️ Important Notes

- **Audio files are not tracked in git** — the `songs/` folder (~231 MB of MP3s) is excluded via `.gitignore` to keep the repository small. Add your own MP3 files (e.g., `songs/bengali/`, `songs/hindi/`, `songs/english/`) or upload them through the in-app "Add Song" feature.
- The database seed data (`all_data.sql`) references sample file paths — update paths if your filenames differ.
- This is a university/project build; some admin actions (ban, edit, delete) are demo stubs.

---

## 📄 License

MIT — free to use for learning and personal projects.
