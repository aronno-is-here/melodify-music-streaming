# MongoDB Connection Guide

How to start MongoDB, connect it to the project, and manage the database with MongoDB Compass.

---

## 1. Start MongoDB (database server)

Run this in a terminal (PowerShell):

```powershell
& "G:\MongoDB\bin\mongod.exe" --dbpath "G:\MongoDB\data" --logpath "G:\MongoDB\log\mongod.log" --logappend
```

- Runs on `localhost:27017`. Leave this window open.
- If MongoDB is not installed yet, extract `E:\Downloads\mongodb-windows-x86_64-8.0.4.zip` to `G:\MongoDB` and create the `data` and `log` folders first.

> The project's API server will crash on startup if MongoDB is not running — always start MongoDB first.

---

## 2. How the project connects

The connection string lives in `server/.env` (gitignored, never committed):

```env
MONGO_URI=mongodb://127.0.0.1:27017/melodify_db
```

- `server/config/db.js` reads `MONGO_URI` and Mongoose connects automatically when you run the server.
- Seeding (`npm run seed` in `server/`) writes to the same database.

Full connection chain:

```
MongoDB (27017)  ←  Mongoose  ←  Express (5000)  ←  Vite proxy  ←  Browser (5173)
```

---

## 3. Seed the database (first time / reset)

```powershell
# in the server/ folder
npm install
npm run seed
```

Creates the 14 songs + admin user in `melodify_db`.

---

## 4. Connect with MongoDB Compass (GUI)

1. **Start MongoDB first** — see step 1. Compass cannot connect otherwise.
2. Open **MongoDB Compass** → on the "New Connection" screen, paste:

   ```
   mongodb://127.0.0.1:27017
   ```

   (port 27017 is the default; leave username/password empty — the local DB has no auth)
3. Click **Connect** → you'll see your databases on the left.
4. Click **`melodify_db`** → collections:
   - `songs` — the 14 seeded songs
   - `users` — admin + any registered users
   - `playhistories` — recently played per user
   - `playlists`, `reports`, `subscriptions`

If `melodify_db` exists but `songs` is empty, you haven't seeded yet — run `npm run seed` (with mongod running) and refresh Compass.

---

## 5. What you can do in Compass

- **Browse documents** — view every song/user/playhistory doc in a table view
- **Edit/delete documents** — fix typos, remove test data by hand
- **Run queries** — e.g. `{ title: /love/i }` to filter songs
- **Aggregations tab** — group/sort/count (e.g. top played songs) without writing code
- **Indexes** — create/drop indexes to speed up searches
- **Import/Export** — dump collections to JSON/CSV for backups

> Note: song uploads never go through Compass — uploads happen in the app (Multer saves the MP3 to disk, the API creates the `Song` document). Compass only manages the metadata documents.

---

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| Compass says connection refused | `mongod` is not running — start it (step 1) |
| Server exits with connection error | Same — start `mongod` first, then `npm run dev` |
| Port 27017 already in use | Check with `Get-NetTCPConnection -LocalPort 27017 -State Listen`, kill the old process, or it may be an already-running mongod (fine) |
| Empty `songs` collection | Run `npm run seed` in `server/` with mongod running, then refresh Compass |
