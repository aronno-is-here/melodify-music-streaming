# Melodify — Running & Admin Guide

This guide explains how to run the Melodify website manually (step by step) and how to use/manage the Admin Panel.

---

## 1. Running the Website Manually

### Requirements

- **Node.js** (project runs on Node 24)
- **MongoDB 8.0.4** installed at `G:\MongoDB` (zip kept at `E:\Downloads\mongodb-windows-x86_64-8.0.4.zip`)
- `npm` (comes with Node.js)

The website is made of 3 services that must all be running:

| Service       | Technology  | URL                | Port  |
| ------------- | ----------- | ------------------ | ----- |
| Database      | MongoDB     | `localhost:27017`  | 27017 |
| API backend   | Express     | `http://localhost:5000` | 5000 |
| Frontend      | React + Vite| `http://localhost:5173` | 5173 |

The frontend proxies `/api` and `/assets` requests to the API on port 5000, so you only need to open the frontend URL in the browser.

---

### Step 1 — Start MongoDB (database)

Open a terminal and run:

```powershell
& "G:\MongoDB\bin\mongod.exe" --dbpath "G:\MongoDB\data" --logpath "G:\MongoDB\log\mongod.log" --logappend
```

- MongoDB starts on `localhost:27017`.
- **Keep this terminal window open** while the website is running.

> If MongoDB is not installed yet: extract `E:\Downloads\mongodb-windows-x86_64-8.0.4.zip` to `G:\MongoDB` and create the `data` and `log` folders.

---

### Step 2 — Start the API backend (Express)

Open a second terminal and run:

```powershell
cd "D:\Aronno\Works\Melodify - Music Streaming Website\server"
npm install     # first time only
npm run dev
```

- The API runs on `http://localhost:5000` (dev mode auto-restarts on code changes via nodemon).
- **Verify it is up:** open `http://localhost:5000/api/health` — it should return `{"status":"ok"}`.
- **Keep this terminal window open.**

---

### Step 3 — Start the frontend (React + Vite)

Open a third terminal and run:

```powershell
cd "D:\Aronno\Works\Melodify - Music Streaming Website\client"
npm install     # first time only
npm run dev
```

- The website runs on `http://localhost:5173`.
- **Keep this terminal window open.**

---

### Step 4 — Open the website

- Browse to **http://localhost:5173**
- Sign up as a normal user at **http://localhost:5173/signup**
- Login at **http://localhost:5173/login**
- Admin panel: **http://localhost:5173/admin** (see section 2)
- Static pages: `/playlist/`, `/song-details/`, `/premium/`
- Karaoke app: served separately from the `karaoke-app/` folder

---

### First-time setup / resetting the database

If the database is empty or you want to reset it (creates the admin user + 14 songs from the original data):

```powershell
# in the server/ folder
npm run seed
```

---

### Troubleshooting

| Problem | Solution |
| ------- | -------- |
| Port already in use | Find the process: `Get-NetTCPConnection -LocalPort <port> -State Listen`, then stop it and restart the service. |
| API not responding | Check `server/server.log` for errors. |
| Frontend errors | Check `client/vite.log`. |
| Songs not playing / posters missing | Media lives in `assets/songs/` (MP3s) and `assets/posters/`. Make sure the server is running — the frontend proxies `/assets` to it. Do not delete the MP3 folder; it is gitignored. |
| `npm run dev` not found | Run `npm install` in that folder first. |

---

## 2. Managing the Admin Panel

### Access

1. Make sure all 3 services are running (see section 1).
2. Go to **http://localhost:5173/admin**.
3. Log in with the admin credentials from your `server/.env` file.

**Where do the credentials come from?**

The admin password is **never hardcoded** in the codebase (so it is not exposed in the GitHub repo). It is stored in `server/.env` (a gitignored local file):

```env
ADMIN_EMAIL=admin@melodify.com
ADMIN_PASSWORD=your-strong-password
```

- When you run `npm run seed` in `server/`, the admin user is created with the email/password from `.env`.
- If `ADMIN_PASSWORD` is missing from `.env`, the seed generates a **random password** and prints it to the console once (save it immediately — it is not shown again).
- To change the password: update `ADMIN_PASSWORD` in `server/.env`, then either re-seed (deletes the admin user first) or update the password directly in the database (see below).

**Login rules:**

- Only accounts with the role `admin` can enter the panel.
- If you log in with a normal user account you will see `Admin access required. Use the admin credentials.`
- Wrong email/password shows `Invalid credentials`.

---

### Panel sections

After logging in you see the **Melodify Admin Panel** with a navigation sidebar on the left. The **Logout** button is in the top-right.

#### 1. Dashboard
Overview cards showing:
- **Total Users**
- **Total Songs**
- **Daily Plays**
- **Revenue** (in USD)

These numbers come from the API (`/api/admin/stats`) and refresh when you log in or make changes.

#### 2. User Management
- Table of all registered users (ID, Name, Email, Role).
- Use the **Search users...** box to filter by name or email.
- **Edit** / **Ban** buttons: currently placeholders (they show an alert; they do not change the database yet).

#### 3. Music Catalog
**Add a new song** with the form:
- **Title** (required)
- **Artist** (required)
- **Genre** (dropdown: Pop, Rock, Bengali, Hindi)
- **Duration** (e.g. `3:45`)
- **Song File** (MP3/WAV, required) — uploaded to `assets/songs/`
- **Poster Image** (JPG/PNG) — uploaded to `assets/posters/`
- **Release Date**

Click **Add Song** — on success you see a green message *"Song added successfully!"* and the song appears in the catalog table (and on the user dashboard). On failure a red error message shows what went wrong.

The table below lists the latest 20 songs. **Edit** / **Delete** buttons are currently placeholders (alerts only, database is not changed).

#### 4. Content Moderation
Lists moderation reports and claims (ID, Type, User, Content ID, Reason, Status). Seeded with sample reports. The **Resolve** button is currently a placeholder (alert only).

#### 5. Analytics Dashboard
- Stat cards (same numbers as Dashboard).
- A **User Growth Chart** canvas is displayed (currently a placeholder — no live chart rendering yet).

#### 6. Subscription & Payment Management
Table of subscriptions (User Email, Status, End Date, Amount). Shows payment records; **Extend** / **Cancel** buttons are currently placeholders (alerts only).

#### 7. System Settings
- **Default Theme** (Dark / Light)
- **Max Downloads per User** (default `5`)
- **Save Settings** currently only shows *"Settings saved"* — settings are not persisted to the database yet.

---

### Resetting or changing the admin password

The password comes from `ADMIN_PASSWORD` in `server/.env`. To change it:

1. Update `ADMIN_PASSWORD` in `server/.env`.
2. Apply it to the existing admin user (either route):

```powershell
# option A — drop the whole database and reseed (also resets songs/reports)
mongosh --eval "db.getSiblingDB('melodify_db').dropDatabase()"   # or use MongoDB Compass
cd "D:\Aronno\Works\Melodify - Music Streaming Website\server"
npm run seed

# option B — keep all data, only re-hash the admin password (run in server/):
node -e "const b=require('bcryptjs'),m=require('mongoose'),d=require('dotenv').config();m.connect(process.env.MONGO_URI).then(async()=>{await m.connection.db.collection('users').updateOne({email:'admin@melodify.com'},{$set:{password:b.hashSync(process.env.ADMIN_PASSWORD,10)}});console.log('admin password updated');process.exit(0)});"
cd "D:\Aronno\Works\Melodify - Music Streaming Website\server"
npm run seed
```

3. Restart the API and log in with the new credentials.

---

## 3. URL Reference

| Page                | URL                            |
| ------------------- | ------------------------------ |
| Home                | `http://localhost:5173/`       |
| Login               | `http://localhost:5173/login`  |
| Sign up             | `http://localhost:5173/signup` |
| User Dashboard      | `http://localhost:5173/dashboard` |
| Profile             | `http://localhost:5173/profile` |
| Admin Panel         | `http://localhost:5173/admin`  |
| Playlist (static)   | `http://localhost:5173/playlist/` |
| Song Details (static)| `http://localhost:5173/song-details/` |
| Premium (static)    | `http://localhost:5173/premium/` |
| Karaoke             | open `karaoke-app/` separately |

> Dashboard and Profile require login — visitors are redirected to `/login`.
