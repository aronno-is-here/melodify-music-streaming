# 🎵 Melodify — Music Streaming Website

A full-featured music streaming web application with user authentication, a song library with a YouTube-powered player, playlist support, an admin panel, and a real-time karaoke recorder. Built with the **MERN stack** (MongoDB, Express, React, Node.js) — migrated from the original PHP + MySQL version (archived in `legacy/`).

---

## ✨ Features

### User Side
- **Multi-step sign-up flow** — email → password → profile details (name, DOB, gender, country)
- **Login / Logout** with JWT authentication and bcrypt password hashing
- **JWT purpose separation (04/43)** — access tokens carry `token_use: "access"`; password-reset tokens carry `token_use: "password-reset"`. Each flow rejects cross-purpose, missing, unknown, or malformed purposes. Existing sessions require re-login, and older reset links must be requested again.
- **Reset-token handling (05/43)** — reset JWTs are not logged or returned to clients; reset-route failures and reset-sensitive global errors use fixed safe responses without logging raw errors or request bodies. Purpose separation remains enforced. Secure reset-token delivery is not yet implemented; the generic forgot-password acknowledgement does not indicate actual email delivery.
- **Stale access-token invalidation (06/43)** — access tokens issued before a user's `passwordChangedAt` are rejected with the generic 401; tokens issued at or after that time remain valid (same-second tokens count as fresh). Password change and reset flows update `passwordChangedAt`; signup and fresh logins are unaffected.
- **Song library** — search by song title or artist, browse a poster grid
- **Recently Played** — horizontal slider of your latest 20 played songs (per-user history; written once on confirmed playback start, not on click)
- **Confirmed-playback telemetry (15–16/43)** — authenticated clients emit playback lifecycle evidence to `POST /api/listening-events` after real media confirmation, including manual `skipped` and same-session confirmed `replay-started`; 15s throttled progress with seek-safe listened-delta ≤120s; serialized queue; 503 runtime disable with no retry/toast/blocking
- **Explicit preference evidence foundation (17/43)** — bounded internal loader derives current positive evidence from song Favorites and user-owned playlist memberships, deduplicates within each source, and filters deleted Song references; no aggregation or numeric recommendation weights yet
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
│   ├── models/                    # User, Song, Playlist, Report, Subscription, PlayHistory, ListeningEvent
│   ├── utils/catalogIdentity.js   # Pure catalog identity and legacy YouTube lookup helpers
│   ├── utils/catalogSyncRequest.js # Pure admin catalog-sync request validator (10/43)
│   ├── utils/listeningEventRequest.js # Pure listening-event HTTP request/result mapping (14/43)
│   ├── utils/tokenPurpose.js      # Pure access/reset token purpose validation
│   ├── utils/resetSecurity.js     # Reset endpoint matching and safe error responses
│   ├── utils/accessTokenFreshness.js # Access-token freshness vs passwordChangedAt
│   ├── services/youtubeCatalogClient.js # Bounded server-side YouTube Data API client (07/43)
│   ├── services/youtubeMusicNormalizer.js # Pure YouTube candidate normalizer (08/43)
│   ├── services/catalogUpsertService.js # Idempotent YouTube catalog upsert service (09/43)
│   ├── services/catalogSyncService.js # Bounded admin catalog-sync orchestrator (10/43)
│   ├── services/listeningEventService.js # Listening interaction recording service (13/43)
│   ├── services/explicitPreferenceSignalService.js # Bounded current Favorite/Playlist evidence (17/43)
│   ├── middleware/                # JWT auth, admin guard, multer upload
│   ├── routes/                    # /api/auth, /api/songs, /api/playlists, /api/history, /api/subscriptions, /api/admin, /api/listening-events
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
│   │   └── Admin/                 # Admin panel + login (incl. catalog-sync form, 11/43)
│   ├── src/context/               # Auth context (JWT), PlayerContext + listeningTelemetry (15–16/43)
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

### Catalog identity foundation (03/43)

`server/utils/catalogIdentity.js` trims and lowercases provider names (maximum 128 characters), trims case-preserving external IDs (maximum 256 characters), and returns a JSON-encoded pair for explicit identities. Invalid or overlong components return `null`; `youtube_id` is only a separate legacy lookup candidate and never supplies canonical metadata.

`Song` defines a unique compound index on `{ source_provider: 1, external_id: 1 }`, restricted to documents where both fields satisfy `{ $type: 'string', $gt: '' }`. Its `{ youtube_id: 1 }` lookup index is non-unique with the same non-empty-string filter. These definitions exclude missing, null, and empty-string identities; this checkpoint performs no database migration, deduplication, or index execution.

Run the database-free configuration, Song schema/index, and catalog identity tests from the repository root:

```bash
node --test server/config/recommendation.test.js server/models/Song.test.js server/utils/catalogIdentity.test.js
```

### YouTube catalog client (07/43)

`server/services/youtubeCatalogClient.js` is a server-side YouTube Data API client with two bounded operations: `searchMusicVideos(options)` (exactly one `search.list` request per call: `part=snippet`, `type=video`, query trimmed and length-bounded, `maxResults` an integer 1–50 defaulting to 5, optional bounded `pageToken`) and `getVideoDetails(videoIds)` (exactly one `videos.list` request per call: trimmed/deduplicated/empties-removed ID batches of 1–50, `part=snippet,contentDetails,status`). The client depends only on Node's native `fetch`, uses the fixed `https://www.googleapis.com/youtube/v3` host (callers cannot supply hosts or extra API fields), and attaches `YOUTUBE_API_KEY` only to outbound request URLs — the key is read from the server environment (see `server/.env.example`), never from `VITE_*` variables, and never appears in thrown errors, logs, or responses. Importing or constructing the client never requires the key; only an attempted operation fails with the generic "YouTube catalog API is not configured" message. Every request has a 9-second `AbortController` timeout, and there are no retries, no automatic pagination, and no background timers. Failures (network, timeout, non-2xx, malformed JSON) surface as sanitized operation-level errors without upstream bodies or URLs. Tests inject `fetch` and never touch the network:

```bash
node --test server/services/youtubeCatalogClient.test.js
```

No catalog synchronization, database writes, routes, or UI exist yet; `RECOMMENDATION_CATALOG_SYNC_ENABLED` remains unwired until the future secure catalog-sync checkpoint (10/43).

### YouTube candidate normalization (08/43)

`server/services/youtubeMusicNormalizer.js` turns raw 07/43 search + video-details responses into deterministic, bounded candidate objects for the future catalog upsert layer: stable YouTube source identity (`source_provider: "youtube"`, `external_id`/`youtube_id` = video ID via the shared catalog-identity helpers), trimmed titles, ISO-8601 duration parsing to `duration_seconds` plus Song-compatible display duration (`253 → "4:13"`, `3723 → "1:02:03"`), highest-quality http/https thumbnail selection (`maxres → standard → high → medium → default`, else `null`), normalized status fields (`privacy_status`, `upload_status`, `embeddable`, `live_broadcast_content`), and a conservative `catalog_eligible` flag with a fixed ineligibility-reason vocabulary. The artist field is only a clearly provisional `artist_candidate`: exact `" - Topic"` channel suffixes are stripped (source `topic-channel`), other channels pass through untouched (source `channel-title`), and video titles are never parsed for artists. Category ID `10` maps to `category: "Music"`; **genre, language, and mood are never inferred** and remain `null`/absent. `normalizeYouTubeMusicCandidates(search, details)` preserves search order, dedupes IDs, ignores unrelated details, omits searched videos lacking authoritative details, never mutates inputs, and stores no raw response bodies. Pure functions only — no MongoDB catalog import exists yet:

```bash
node --test server/services/youtubeMusicNormalizer.test.js
```

### Idempotent catalog upsert (09/43)

`server/services/catalogUpsertService.js` persists a single normalized 08/43 candidate through the factory `createCatalogUpsertService({ SongModel, now })`, which returns `{ upsertYouTubeCandidate(candidate, context) }`. Results are one of `inserted`, `updated`, `adopted-legacy`, `skipped`, or `conflict`, with a null reason or a fixed code (`ineligible`, `invalid-identity`, `missing-artist`, `ambiguous-legacy-match`, `conflicting-legacy-identity`, `persistence-failed`); database errors are never surfaced raw. Validation happens before any model or clock call: identity must be `source_provider: "youtube"` with `external_id === youtube_id`, `catalog_eligible === true` with a valid title and duration, and a non-empty `artist_candidate` for new inserts. New documents use the literal genre sentinel `"Unknown"` unless an explicit `context.genre` is supplied (`normalized_genre` only from that explicit genre, lowercased); `language` is stored only when explicitly provided — genre and language are never inferred. Existing curated fields (`title`, `artist`, `genre`, `lyrics`, `chords`, `file_path`, `release_date`) and `_id` are never overwritten; refreshes only apply the import-managed whitelist (`youtube_id`, `source_provider`, `external_id`, `poster_url`, `duration`, `duration_seconds`, `category`, `recommendation_eligible`, explicit `language`, `metadata_refreshed_at`). Lookup order: canonical identity update in place; else one `youtube_id` match with empty canonical identity is adopted on the same `_id` (`adopted-legacy`) with provenance `{ source: "youtube", reference, imported_at }`; multiple matches or a foreign canonical identity return a conflict with no mutation; zero matches use one atomic `findOneAndUpdate` upsert with at-most-one E11000 recovery re-read. The injected `now()` clock is called at most once per operation (zero on skip/conflict). No bulk sync, routes, admin UI, or destructive delete/merge methods exist yet. Tests use a fake in-memory SongModel and fixed clock — no MongoDB, no network:

```bash
node --test server/services/catalogUpsertService.test.js
```

### Admin catalog sync API (10/43)

`POST /api/admin/catalog-sync` is an admin-only, feature-flagged endpoint on the existing admin router (middleware chain: `protect`, then `adminOnly`). It requires the 01/43 flag `RECOMMENDATION_CATALOG_SYNC_ENABLED=true`; when disabled it returns `503` without calling YouTube or MongoDB. The request body is exactly `{ query: string, genre?: string, language?: string, maxResults?: number }` — validated by the pure helper `server/utils/catalogSyncRequest.js` (query required/trimmed/non-empty/≤200 chars; genre ≤128 and language ≤64 after trim with empty→absent; `maxResults` integer default **5**, hard maximum **10**, values above 10 rejected rather than escalated). `server/services/catalogSyncService.js` (`createCatalogSyncService({ youtubeClient, normalizer, catalogUpsertService, catalogSyncEnabled })` → `syncCatalogSearch`) runs one bounded pipeline per request: exactly **one** `searchMusicVideos` (no `pageToken`), then at most **one** `getVideoDetails` (skipped when zero IDs), then sequential 09/43 `upsertYouTubeCandidate` calls capped at `maxResults` — no pagination, no retry, no background job. Genre/language are explicit admin context only (never derived from query/title/channel/category); when omitted, 09/43 defaults apply (`"Unknown"` genre, unset language). Upstream failures surface only as sanitized `502` responses; individual skipped/conflict/persistence-failed candidates are counted without aborting the batch. Responses return a bounded summary (`requested`, `searched`, `normalized`, `inserted`, `updated`, `adoptedLegacy`, `skipped`, `conflicts`, `failed`) plus at most 10 safe per-item entries (`videoId`, `songId`, `status`, `reason`). Automatic pagination, scheduled sync, and real YouTube production verification do not exist yet:

```bash
node --test server/utils/catalogSyncRequest.test.js server/services/catalogSyncService.test.js
```

### Admin catalog sync UI (11/43)

The Admin → Music Catalog section includes a manual **YouTube Catalog Sync** form (`client/src/pages/Admin/CatalogSyncPanel.jsx`, with pure helpers in `catalogSyncUi.js`). Fields: required **Search query** (trimmed, non-empty, max 200 chars), optional **Genre** text (trimmed, max 128, blank omitted — free text, not a forced taxonomy), optional **Language** text (trimmed, max 64, blank omitted — never inferred), and **Max results** number input hard-bounded to integer **1–10** (default 5). Submit builds a whitelisted payload `{ query, maxResults, genre?, language? }` only and POSTs it through the existing authenticated API client to `/api/admin/catalog-sync` (Bearer token from `localStorage`; 401 handling unchanged). The browser never holds `YOUTUBE_API_KEY` or any `VITE_*` YouTube credential — the server performs YouTube calls. One in-flight guard disables the button and shows “Syncing catalog...” with no polling or duplicate submissions. On success the panel renders the bounded 10/43 summary counts (Requested/Searched/Normalized/Inserted/Updated/Adopted Legacy/Skipped/Conflicts/Failed) and, when present, a compact ≤10-row table of Video ID / Song ID / Status / Reason with human-readable labels (`adopted-legacy` → “Adopted legacy”, `persistence-failed` → “Persistence failed”). Errors are mapped to safe fixed messages (503 → “Catalog synchronization is currently disabled.”, 502 → “YouTube catalog service is temporarily unavailable.”, 500/unknown → “Catalog synchronization failed.”); nested/raw backend objects are never rendered. A new submit clears the previous error and result first. The feature flag remains server-side only — the panel is not hidden by client guesses. There is no page-load sync, auto-refresh of the song list after sync, background job, or pagination loop. Production YouTube sync has not been live-verified:

```bash
node --test src/pages/Admin/catalogSyncUi.test.js
```

### Listening event data model (12/43)

`server/models/ListeningEvent.js` is a new Mongoose model for **raw** playback interaction evidence (separate from `PlayHistory`, which still powers Recently Played and is unchanged). Each document references stable `user` and `song` ObjectIds (no `user_email`), plus required `session_id` and `event_id` strings (trimmed, non-empty, ≤128 chars) and an integer `sequence` in `0…1,000,000` for ordering within a session. `event_type` is a fixed enum of playback-lifecycle values only: `play-started`, `progress`, `paused`, `resumed`, `seeked`, `completed`, `skipped`, `stopped`, `replay-started`. Optional bounded numerics: `position_seconds` and `duration_seconds` (`0…86400`, duration exclusive of 0), `listened_seconds_delta` (`0…120` per event), and seek anchors `seek_from_seconds`/`seek_to_seconds` (`0…86400`) so future logic can exclude seek jumps from listening time. Optional `client_occurred_at` is an untrusted client Date with **no** `Date.now` default — server `createdAt`/`updatedAt` from `timestamps: true` remain authoritative. Optional finite enums: `transition_reason` (`manual-next`, `manual-previous`, `new-selection`, `track-ended`, `repeat`, `route-change`, `logout`, `player-error`, `unknown`) and `playback_source` (`dashboard`, `homepage`, `playlist`, `song-details`, `user-profile`, `unknown`). Schema indexes (metadata only; never synced to a live DB in this checkpoint): unique `{ user, event_id }` for idempotent submissions, unique `{ user, session_id, sequence }` for ordered sessions, plus `{ user, createdAt: -1 }` and `{ song, createdAt: -1 }` for chronological analytics. **No TTL.** Derived recommendation weights, completion percentages, early-skip flags, preference scores, emails, JWTs, IPs, and user agents are **not** stored as trusted client fields — they belong to later server-side derivation. There is no Trending logic or live listening analytics derived from this model yet (client emission starts at 15/43):

```bash
node --test server/models/ListeningEvent.test.js
```

### Listening interaction recording service (13/43)

`server/services/listeningEventService.js` exposes `createListeningEventService({ ListeningEventModel, SongModel, now })` → `recordListeningEvent({ userId, event })`. **Trusted user binding:** `userId` comes only from the service argument (future `req.user` in 14/43); the event payload is whitelisted to the 12/43 fields and can never override `user`, inject `createdAt`/`updatedAt`, or persist score/weight/preference/email/JWT/IP fields. Malformed ObjectIds and missing Songs are rejected safely (`invalid-event`, `song-not-found`) with a bounded single Song lookup that never mutates or creates Songs. Event-id idempotency: a matching `{ user, event_id }` with the same core identity (song, session, sequence, type) returns `duplicate`/`duplicate-event` with zero second create; a different core identity returns `event-id-conflict`. Sequence slots occupied by another event_id return `sequence-conflict`. Session rules: first event must be sequence `0` `play-started` (`invalid-session-start`); later sequences must strictly increase (gaps allowed, renumbering never happens — lower values get `out-of-order-sequence`). Basic transitions only: `play-started` only at session start; after terminal (`completed`/`skipped`/`stopped`) only `replay-started`; `resumed` requires a prior `paused` (`invalid-transition`) — no completion-percent or early-skip logic. Cross-field checks: position/seek points may exceed duration by at most **2s** (`POSITION_DURATION_TOLERANCE_SECONDS`); `seeked` requires both seek anchors and zero listened delta, non-seek events must not carry seek fields (`invalid-seek`). Client time is optional and bounded by the injected `now()` to **+300s** future / **24h** stale (`invalid-client-time`); regression vs the previous event’s client time returns `client-time-regression`; server `createdAt` remains authoritative. Listened-delta rules: non-listening transitions (`play-started`/`resumed`/`seeked`/`replay-started`) must claim 0 (`non-listening-transition-delta`); positive claims after `paused`, above forward position advance +2s, above client wall-time +2s, or with backward position are rejected (`invalid-listened-delta`); **seek distance is never counted as listening** and paused intervals are never counted. Persistence creates exactly one document with the trusted user; E11000 performs at most one bounded recovery lookup (duplicate or conflict) with create attempts capped at 1; other DB failures return fixed `persistence-failed` without raw messages. **PlayHistory is still untouched**, and there is **no listening API endpoint or client PlayerContext tracking yet**. Tests use fake models and a deterministic clock:

```bash
node --test server/services/listeningEventService.test.js
```

### Authenticated listening-event API (14/43)

`POST /api/listening-events` is a normal-user endpoint (`server/routes/listeningEventRoutes.js`, mounted once in `server/server.js`). Middleware chain is **`protect` only** — no `adminOnly`. User identity comes exclusively from authenticated `req.user._id`; body/query/params `user` or `userId` fields cannot select another account. The route is gated by `RECOMMENDATION_LISTENING_EVENTS_ENABLED` (01/43): when disabled it returns **503** with a fixed message **before** request parsing or any service/Song/ListeningEvent work. Order is: JWT `protect` → feature flag → pure parser → one `recordListeningEvent` call. Request bodies must be plain JSON objects containing **only** the 13 whitelisted fields (`song`, `session_id`, `event_id`, `sequence`, `event_type`, `position_seconds`, `duration_seconds`, `listened_seconds_delta`, `client_occurred_at`, `transition_reason`, `seek_from_seconds`, `seek_to_seconds`, `playback_source`); arrays, primitives, unknown keys, and identity/derived fields (`user`, `userId`, `createdAt`, `score`, `weight`, `recommendation_score`, tokens, nested `metadata`, …) are rejected as `400 invalid request body`. Exactly **one event per request** (no batch endpoint). Service outcomes map to bounded statuses: `recorded` → **201**, `duplicate` → **200**, other `rejected` → **400**, `song-not-found` → **404**, `conflict` → **409**, `failed`/unexpected → **500**; `success` is true only for recorded/duplicate. Responses expose only `{ status, reason, event_id?, session_id?, sequence?, song? }` plus a fixed message — never raw Mongo/Mongoose errors, stacks, emails, or full documents. **No PlayHistory write** on this route (history is centralized in the client at confirmed start since 15/43).

```bash
node --test server/utils/listeningEventRequest.test.js server/routes/listeningEventRoutes.test.js
```

### Confirmed playback telemetry client (15/43)

`client/src/context/listeningTelemetry.js` is a pure controller factory (`createListeningTelemetryController`) owned by a single ref in `PlayerContext.jsx`. **`play-started` is never emitted from click intent**; it fires only after confirmed media playback — YouTube IFrame `PLAYING` or HTML audio `play`. `resumed` (not a second `play-started`) follows `paused`. Progress is throttled to `PROGRESS_EMIT_INTERVAL_SECONDS` (15) using the existing poll/`timeupdate` observation (no second interval); `listened_seconds_delta` is forward position advance only, clamped to `MAX_LISTENED_DELTA_SECONDS` (120), never seek distance, never paused wall-clock time. `seeked` carries bounded `seek_from_seconds`/`seek_to_seconds` with zero delta and resets the progress baseline to the destination. Natural media end emits one `completed` after flushing remaining progress; the session is then terminal until confirmed replay (16/43). A different selected track gets its own session; sequence starts at `0` on first confirmed play; event/session IDs use `crypto.randomUUID()` (crypto-strong fallback, ≤128 chars). Sends are serialized through a per-session promise queue (gaps allowed after failures; one failure never breaks the queue; no retries; playback never waits on telemetry). Events are only posted when `melodify_token` exists (existing API client); payloads contain only the 13 whitelisted fields — no `user`/`userId`/token. Server **503** (`Listening event recording is disabled`) disables telemetry for the current page runtime with no polling, toast, or user-visible error. **PlayHistory** is recorded once per confirmed session start via the existing `POST /api/history` contract, independent of listening-event 503 disablement; Dashboard’s click-based `recordPlay` write was removed.

```bash
node --test client/src/context/listeningTelemetry.test.js
```

### Skip and replay playback telemetry (16/43)

- `skip({ reason, position, duration })` records manual abandonment only after confirmed playback, while the session is non-terminal and the player is changing to a different song. Public `next()`, `prev()`, and `playSong(list, index)` retain their interface; one internal switch helper maps them to `manual-next`, `manual-previous`, and `new-selection`, respectively, preventing double skips. Final forward listening is flushed as `progress` before one terminal `skipped`; the skip itself has no positive listened delta. Unstarted selection changes simply prepare a fresh session without invalid skip events.
- Natural YouTube/HTML completion remains `completed`, never `skipped`. Automatic advance and error recovery carry no manual skip reason. A different auto-advanced song waits for confirmed playback before its fresh `play-started`.
- Only confirmed playback of the same current track after natural completion emits `replay-started` with reason `repeat`, retaining `session_id` and continuing sequence numbers. Repeat toggle, reload request, and seek-to-zero alone emit no replay. Each confirmed replay resets the progress baseline and active/paused state, supporting subsequent progress, pause/resume, seek, completion, and multiple replay cycles. A skipped track selected again starts a fresh session instead.
- Previous still wraps to the prior entry with no time-threshold restart rule. If a one-song list, shuffle, or direct selection reloads the same active song, it is not a skip or replay: an active reload is observed as a seek to zero when a valid position is available; a paused reload resets its baseline on confirmed resume. Restart behavior is otherwise unchanged; unavailable media positions cannot supply a seek observation.
- Skip/replay sends share the existing serialized queue, never block playback/navigation/repeat, and have no retries or user-visible failure UI. Runtime 503 disables later listening-event sends while history remains independent. Neither skip nor same-session replay adds a PlayHistory write; a newly confirmed session records history once. Preference aggregation, evidence-based Trending, recommendation ranking, and ML remain unimplemented.

### Current Favorite and Playlist evidence (17/43)

`server/services/explicitPreferenceSignalService.js` exposes `createExplicitPreferenceSignalService({ FavoriteModel, PlaylistModel, SongModel, UserModel })` → `getUserExplicitPreferenceSignals({ userId })`. Models have production defaults and are injected as fakes in tests. The direct trusted user ID must be an ObjectId or 24-character hexadecimal string; malformed IDs fail before any read. Because existing Favorites use `user`/`song` ObjectIds while Playlist ownership uses `user_email`, one ID-scoped User lookup reads only `_id` and `email` to resolve the persisted owner. Caller-supplied emails or nested alternate users cannot change scope. A missing User yields empty evidence; malformed persisted identity or query failure throws the fixed `Explicit preference signal loading failed` error without original persistence details.

The result is `{ signals, counts: { favorites, playlistMemberships, total }, truncated: { favorites, playlists, memberships } }`. Signals contain exactly `{ type, song_id, source_id, occurred_at }`; the frozen vocabulary is `favorite` and `playlist-membership`. Current Favorites produce explicit positive favorite evidence, deduplicated by song; within the bounded source window, the earliest valid `createdAt` wins, unknown timestamps sort last, and ties use the lowest Favorite ID. Playlist `items[{ songId, addedAt }]` are deduplicated by playlist + song, retaining the earliest known factual `addedAt`; the same song in different playlists remains separate evidence. Missing/invalid times are `null`: neither current time nor Playlist `createdAt`/`updatedAt` substitutes for membership time.

Reads are lean, projection-limited and deterministic: source documents are ordered by ascending `_id`; **1,000 Favorite rows** and **250 Playlist documents** are retained, with one extra row per read solely to detect overflow. Each fetched playlist array is projected to at most **5,001 items** (including lookahead), and at most **5,000 raw membership slots total** are inspected across retained playlists in source-ID then persisted array order. Invalid and duplicate slots consume that conservative scan budget, so `truncated.memberships` means additional membership slots went unexamined, even if fewer than 5,000 distinct signals survive. The other truncation flags report source-document overflow; flags are independent and remain set after filtering. No pagination or retries occur. Unique referenced song IDs (at most 6,000) use **one bounded, ID-only Song query**, skipped entirely when no candidates exist. Deleted/stale references are dropped; counts reflect surviving signals. Final ordering is `type`, then canonical lowercase `song_id`, then `source_id`.

Existing Favorite and Playlist state remains the source of truth: old records count automatically, and removed Favorites/memberships disappear on the next load. Removal is **not dislike** and produces no negative signal. Post/social likes, listening events, and playback history are excluded. No numeric recommendation weights, scores, or user-preference aggregation are implemented. No new API, write-event model, collection, route hook, or migration was added.

Run the database-free service tests from the repository root:

```bash
node --test server/services/explicitPreferenceSignalService.test.js
```

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
- The search field uses a compact 223 × 33px navy pill with an accessible label and readable placeholder.
- Header actions use an outline bell and a 32px purple profile circle linking to profile or sign-in according to authentication.
- The desktop hero is a compact 390px composition aligned to the shared content container.
- Hero art is cropped into the right half, mirrored toward the text, with masked edges rather than a rectangular photo panel.
- Blue/violet color lighting and dark tonal grading unify the listener portrait with the hero atmosphere.
- Hero eyebrow copy uses compact 13px white lettering with restrained tracking above the headline.
- The desktop headline is 48px and preserves exactly two lines: “Every Sound.” / “One Universe.”
- “Sound.” uses violet emphasis and “Universe.” transitions into blue; solid-color and forced-color fallbacks keep both words readable.
- Hero supporting copy is constrained to 380px with pale-blue 15px text and compact three-line desktop wrapping.
- Hero actions are 44px pills with a 16px gap: a white-on-gradient primary and a navy outlined secondary.
- A short dark hero fade flows into Trending with a 22px section inset instead of large stacked vertical padding.
- Trending has an 18px heading, short violet/blue accent, compact subtitle, and vertically centered View All action.
- Trending keeps six equal desktop cards and reserves a compact loading grid while `/api/songs?limit=6` resolves.
- Trending cards have dark navy surfaces, subtle borders, 10px corners, and stationary hover/focus feedback. The grid uses six columns above 1024px, four on small tablets, three at 768px and below, and two at 480px and below, with compact 14–10px gaps and shared container gutters.
- Studio and Premium promotions share the Trending container, a 36px section inset, and equal-width, equal-height desktop cards separated by 16px. Compact content determines card height above a 154px minimum; cards stack below 769px without fixed-height clipping.
- The Studio promotion is a labeled article with a narrow, decorative equipment strip beside its copy, pale-blue supporting text, and a violet-outlined pill linking to Studio or sign-up according to authentication. Its two-column composition adapts without overlaying the text on photography.
- Studio equipment photography (Unsplash photo `1598488035139-bdbb2231ce04`) is cropped vertically and graded with purple/blue lighting and dark edge shading. Local `client/public/home/studio-waves.svg` adds subdued background lines; `studio-equipment.svg` supplies a one-shot local artwork fallback if the photo is unavailable. Both decorative SVGs are original project assets.
- The Premium promotion uses a navy/violet surface and original local `client/public/home/premium-crown.svg` and `premium-ribbons.svg` artwork, with no third-party branded imagery. Static, right-weighted ribbon lighting sits behind the content without animation or additional dependencies. On narrow screens the ribbons dim and the decorative right-hand crown yields to the compact gold badge so the copy retains its space.
- Each card uses 66px inset artwork. `client/public/home/poster-fallback.svg` is a local fallback with a one-shot error guard.
- Song metadata uses compact title/artist/duration rows; long names truncate visually while retaining their full tooltip text.
- Persistent 29px outlined play affordances sit at each card’s bottom-right; the whole card preserves existing song/sign-up navigation.
- Durations accept API clock strings, numeric seconds, and explicitly marked milliseconds (`duration_ms` or `ms` suffix); unavailable/invalid values display an em dash. Run `node --test src/components/home/formatDuration.test.js` from `client/` for the regression checks.
- Hero photography: [Andrea Piacquadio / Pexels, photo 3771823](https://www.pexels.com/photo/3771823/), a headphone listener. The previously supplied Unsplash URL resolves to a microphone and is intentionally replaced. The reference screenshot remains local-only.
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
