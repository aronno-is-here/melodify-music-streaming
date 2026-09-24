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
- **Explicit preference evidence foundation (17/43)** — bounded internal loader derives current positive evidence from song Favorites and user-owned playlist memberships, deduplicates within each source, and filters deleted Song references; no numeric recommendation weights
- **Factual user preference aggregation (18/43)** — bounded internal per-song and artist/genre/language summaries combine windowed listening with current explicit evidence; no recommendation scoring or active AI recommendations
- **Transparent Trending score engine (19/43)** — pure global ranking of recent ListeningEvent activity over a fixed 7-day window with 24-hour half-life decay and documented coefficients; **not AI**, not personalized; no API, UI, fallback, or ML yet
- **Authenticated Trending API (20/43)** — `GET /api/trending` behind login (`protect`) and `RECOMMENDATION_TRENDING_ENABLED`; strict `limit` query only (default 10, max 50); bounded 7-day ListeningEvent read (50,000-row cap with observable truncation), engine ranking + Song eligibility/playability filters; empty list is 200; **not AI**, no personalization, no Dashboard UI yet
- **Trending sparse-data fallback (21/43)** — when activity-ranked songs do not fill the public `limit`, one bounded catalog top-up query (`createdAt` DESC, `_id` ASC) appends playable recommendation-eligible songs marked `basis: "catalog-fallback"` with `score: null` and zeroed activity metrics; activity always ranks first with contiguous `1..N` ranks; meta `mode`/`activity_count`/`fallback_count`; deterministic, **not** AI/personalized/random/popularity evidence; still no Dashboard UI
- **Dashboard Trending Now (22/43)** — Dashboard middle column order is **Recently Played → Trending Now → search → Recommended Songs**; one authenticated `GET /api/trending?limit=10` per mount via the existing API client; activity and catalog-fallback cards stay semantically distinct with **no numeric Trending score** and **no fabricated fallback activity metrics**; playback passes the full filtered Song list to `player.playSong(list, index)` for next/previous continuity; server **503** quietly hides the section; empty/error states are section-local; PlayHistory/listening events remain centralized in PlayerContext (no Dashboard rewrites); **not AI**, no personalized recommendation UI yet
- **Offline Python recommender runtime foundation (23/43)** — new `ml/` package is a **CPU-only, offline, standard-library** training foundation only (not a production HTTP service): hard safety ceilings seed **42**, **250,000** raw events, **50,000** unique users, **25,000** unique songs, **one** worker, **one** numerical-library thread; `configure_cpu_runtime()` binds common numeric-library thread env vars to `1` and clears `CUDA_VISIBLE_DEVICES` for the current process only (idempotent; not an OS CPU quota); resource/data-shape safety bounds for the current 8 GB RAM development workflow, **not** production/API limits; **no** hard OS memory quota claimed; **no** training, model, evaluation, MongoDB access, HTTP server, GPU support, or third-party ML dependency yet; deterministic `runtime-info` summary only
- **Temporal raw-event split (24/43)** — offline recommender now has deterministic **per-user chronological** train/validation/test splitting of ListeningEvent-like records; **playback sessions are indivisible** across partitions; users with ≥3 non-overlapping sessions: all earlier sessions → train, second-latest → validation, latest → test; users with fewer than 3 sessions or overlapping session timelines remain **train-only**; server `createdAt` controls chronology (`client_occurred_at` ignored); same song may legitimately occur across partitions; 23/43 runtime hard caps enforced with **no silent truncation**; **no random split**, no sparse matrix/model/training yet; **25/43** builds the bounded sparse interaction representation
- **Bounded sparse interaction matrices (25/43)** — `build_sparse_interactions()` converts 24/43 `TemporalInteractionEvent` records into **eight** canonical CSR **`float32`** user×song matrices: `observed` (binary presence), `session_count` (distinct sessions), `play_started_count`, `replay_started_count`, `completed_count`, `skipped_count` (**positive** factual count, never a penalty), `stopped_count`, `listened_seconds` (sum of stored `listened_seconds_delta` only); sorted ID row/column order with read-only index maps; lazy NumPy/SciPy import **after** `configure_cpu_runtime()`; only new deps are `numpy>=1.26,<3` and `scipy>=1.12,<2` in `ml/requirements.txt`; **no** training weights/preferences/scores, **no** dense allocation, **no** SVD/model/evaluation/artifacts/MongoDB/HTTP, Favorite/Playlist signals not folded in; **26/43** builds sparse Song content features
- **Sparse Song content features (26/43)** — `build_song_content_features()` deterministically encodes factual Song catalog metadata into one Song × Content Feature CSR **`float32`** matrix; feature families are exactly **`artist`**, **`genre`**, **`language`**, **`category`**; `normalized_artist` / `normalized_genre` take precedence when non-empty, otherwise fall back only to persisted `artist` / `genre`; language and category use only persisted values; **no** inference from title/artist/genre/provider/Unicode; multi-value strings are **not** split on `,` `/` `&` `feat.`; text normalization is **NFKC + trim + whitespace collapse + casefold** (no stemming/transliteration/tokenization); feature names are namespaced (`artist::…`, `genre::…`, `language::…`, `category::…`); values are binary **`1.0`** with **no** family weighting or scores; Songs and feature columns use deterministic lexical ordering with `MappingProxyType` index maps; **zero-feature Songs remain as zero rows**; **no** dense Song×feature or Song×Song matrix, **no** TF-IDF/similarity/nearest-neighbor/recommendation score/model fitting/MongoDB/HTTP/artifact output; NumPy/SciPy dependency set from 25/43 unchanged; **27/43** establishes safe model/artifact version handling
- **Safe recommender artifact store (27/43)** — `ml/recommender/artifacts.py` provides versioned immutable releases under `releases/<version>/` with a SHA-256 `manifest.json` per payload file; publication validates inputs, stages into `.staging/`, fully verifies, then atomically renames into place — **never** auto-creates or updates `current.json`; explicit `activate_artifact_release()` verifies a candidate first, then replaces the schema-1 `current.json` pointer via temp-file + fsync + `os.replace` (previous pointer bytes unchanged on failure); `resolve_active_artifact_release()` returns `None` when no pointer exists, otherwise verifies the referenced release (no auto-latest scanning); payloads are **JSON only** (deterministic sorted-key UTF-8) or **NPZ only** (`allow_pickle=False`, finite boolean/integer/unsigned/float dtypes, ZIP path/size/entry-count inspection before load, **no** filesystem extraction); rejects symlinks, undeclared files, reserved names (`manifest.json`/`current.json`), unsafe version/kind/filename characters, and non-scalar metadata; lazy NumPy loads **after** `configure_cpu_runtime()`; bounded limits: **32** files, **64 MiB** per file, **128 MiB** total, **64** metadata entries / **64 KiB** metadata JSON, **64** NPZ arrays, **256 MiB** uncompressed NPZ, **128** ZIP entries; **no** pickle/joblib/eval/exec/model training/MongoDB/HTTP/cloud/durability claims; `ml/artifacts/` is gitignored; `ml/requirements.txt` unchanged; **28/43** adds recommender evaluation metrics
- **Recommender evaluation metrics (28/43)** — `ml/recommender/evaluation.py` exposes pure `evaluate_recommendations(recommendations_by_user, relevant_by_user, catalog_song_ids, content_features)` that measures caller-supplied ranked recommendations against held-out relevant Song IDs and an evaluation catalog; metrics are Precision@5/10, Recall@5/10, binary NDCG@5/10, MAP@10, Hit Rate@10, Catalog Coverage@10, and intra-list Diversity@10; Precision@K always divides by **K**; NDCG uses binary relevance with log2 rank discounting; AP@K denominator is `min(|relevant|, K)`; Coverage is unique top-10 recommended Songs across evaluable users divided by catalog size; Diversity is mean pairwise cosine dissimilarity over scorable top-10 pairs using sparse CSR rows from the 26/43 content bundle only (zero-feature pairs are excluded from the denominator, never treated as diversity=1); user-averaged metrics are macro-averages over evaluable users (non-empty relevance); missing recommendations for an evaluable user count as an empty ranked list; zero evaluable users returns all metrics as 0.0 (never NaN); canonical 24-hex user/song IDs; frozen result/summary dataclasses; **no** overall/combined score; **no** model training, recommendation generation, SVD/CF/content ranking, MongoDB/HTTP, artifact writes, or relevance inference from playback event types; no dense Song×Song matrix; `ml/requirements.txt` unchanged; **29/43** adds a collaborative latent-factor model
- **Collaborative latent-factor model (29/43)** — `ml/recommender/collaborative_model.py` exposes `build_collaborative_training_signal(bundle)`, `train_collaborative_model(bundle, *, n_components=32, random_seed=42)`, and `score_collaborative_candidates(model, user_id, candidate_song_ids)`; the implicit-signal formula is a **fixed initial heuristic policy** (not learned weights, not an optimized configuration, not a quality claim): `clip(1.00·observed + 0.50·log1p(session_count) + 0.25·log1p(play_started_count) + 1.50·log1p(completed_count) + 1.00·log1p(replay_started_count) + 0.25·log1p(listened_seconds/60) − 0.75·log1p(skipped_count), 0, 8)`; **`stopped_count` is deliberately unused** (ambiguous abandonment); training fits `sklearn.decomposition.TruncatedSVD` (`algorithm="randomized"`, `n_iter=7`, `random_state=seed`) on the CSR `float32` signal with `effective_components = min(requested, users−1, songs−1)`, default/max **32** factors, seed **42**; insufficient data (users/songs/pairs &lt; 2 or zero signal nnz) returns `status="insufficient-data"` with `model=None` (no fake factors); frozen model/result/summary with **read-only float32** factors and `MappingProxyType` maps; scoring is **raw user·song dot products** in exact input order — not probabilities/ratings/confidences, no sigmoid/clip/rank sort/seen-song filtering/content features; unknown user/song raise dedicated errors; lazy NumPy/SciPy/scikit-learn after `configure_cpu_runtime()`; **no** dense user×song reconstruction, Favorite/Playlist/content folding, evaluation-based hyperparameter search, artifact publish, MongoDB/HTTP, or CLI `train` command; only new dependency is `scikit-learn>=1.5,<2` in `ml/requirements.txt`; **30/43** adds deterministic hybrid ranking
- **Deterministic known-user hybrid ranker (30/43)** — `ml/recommender/hybrid_ranker.py` exposes `prepare_hybrid_ranker(collaborative_model, interaction_bundle, content_features)` and `rank_hybrid_candidates(context, user_id, candidate_song_ids, *, limit=20)`; combines 29/43 raw collaborative scores with 26/43 sparse content cosine for **one known user** over an explicit candidate list; weights are a **fixed initial baseline** `COLLABORATIVE_WEIGHT=0.70` / `CONTENT_WEIGHT=0.30` (invariant sum 1.0 — **not learned, not optimized, not a quality claim**; the public API accepts **no** caller-supplied weights/`alpha`/`beta`); collaborative raw scores are **min-max normalized inside the candidate set only** (equal/single-candidate scores map to neutral `0.50`) — a ranking convenience, **not** a probability, confidence, rating, or calibrated preference; content profile is a sparse weighted sum of the user's **positive 29/43 training-signal** entries over 26/43 artist/genre/language/category features (no Favorite/Playlist/18/43 Node sources); content score is sparse cosine in [0,1]; **zero-profile or zero-feature candidate ⇒ `content_score=None`** (no fabricated similarity); missing content ⇒ **hybrid equals the full normalized collaborative score** (no ×0.70 metadata penalty); already-observed Songs are excluded using only the `observed` matrix **before** the single `score_collaborative_candidates()` call; sort order is hybrid DESC → collaborative normalized DESC → collaborative raw DESC → content DESC (missing content last) → **song ID ASC** (input order never breaks ties); `limit` default **20**, max **100**, not required to be ≤ candidate count; frozen `HybridRankedItem` / `HybridRankingResult` / `HybridRankingSummary` with contiguous 1-based ranks and factual counts; `HybridColdStartUserError` / `HybridColdStartSongError` for unknown IDs (**no cold-start fallback, no exploration — future 31/43**); training signal built exactly once in `prepare` (29/43 formula not duplicated); lazy NumPy after `configure_cpu_runtime()` (import alone does not configure env or load numeric libs); **no** dense user×song or Song×Song matrix, no model training, no artifacts, no MongoDB/HTTP, `ml/requirements.txt` unchanged; **31/43** adds cold-start policy and deterministic exploration
- **Cold-start preference and deterministic exploration policy (31/43)** — `ml/recommender/cold_start.py` exposes `normalize_explicit_preference_profile(profile)` and `rank_with_cold_start_policy(hybrid_context, user_id, candidate_song_ids, *, explicit_profile=None, limit=20)`; policy layer **above** 30/43 for known users, unknown (cold-start) users, collaborative-unseen Songs, and a bounded **plain-data** explicit preference bridge (Favorite Song IDs, playlist membership counts, direct artist/genre aggregates — compatible preference data, **not** direct Node/Python service coupling); unknown users are **valid** (zero hybrid calls, no fabricated collaborative scores); known users call `rank_hybrid_candidates` **exactly once** over remaining collaborative-known IDs; profile evidence uses Favorite **+1 unit** and playlist **membership-count units** over 26/43 features; non-empty direct artist/genre aggregates **replace** (never add to) source-Song artist/genre family contributions; policy weights are a **fixed initial baseline** `BASE_HYBRID_POLICY_WEIGHT=0.80` / `EXPLICIT_PROFILE_POLICY_WEIGHT=0.20` (sum 1.0 — **not learned, not optimized, not a quality claim**): both scores ⇒ `0.80·hybrid + 0.20·profile` (`basis="hybrid-profile"`), hybrid only ⇒ **full hybrid** (`basis="hybrid"`, no ×0.80 penalty), profile only ⇒ **full profile** (`basis="profile"`), neither ⇒ exploration-eligible only; profile cosine is sparse in [0,1] or `None` (never fabricated); exploration order is **SHA-256** over `melodify-exploration-v1|user|song` (no wall clock, no built-in `hash`, no randomness) with every-fifth-rank cadence (`EXPLORATION_INTERVAL=5`, `floor(limit/5)` target slots) and deterministic backfill (no duplicates); exploration-selected items have `basis="exploration"` and `policy_score=None` (hybrid/profile diagnostics may remain); exploitation sort is policy DESC → hybrid DESC → profile DESC → song ID ASC; filter order is content membership → profile source Songs → known-user `observed` seen → collaborative-known vs cold-start Song split; frozen `ColdStartRankedItem` / `ColdStartRankingResult` / `ColdStartRankingSummary` with contiguous 1-based ranks and factual counts only (no confidence/probability/rating/accuracy fields); `ColdStartPolicyError` / `ColdStartValidationError` under `RecommenderRuntimeError`; pure Python import (does not configure env or load NumPy); **no** dense profile/matrix, no SVD/evaluation/artifact/DB/HTTP writes, no popularity fallback, no JS service imports, `ml/requirements.txt` unchanged; **32/43** will persist evaluation-run history
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
│   ├── utils/trendingRequest.js      # Pure Trending limit query parser (20/43)
│   ├── utils/tokenPurpose.js      # Pure access/reset token purpose validation
│   ├── utils/resetSecurity.js     # Reset endpoint matching and safe error responses
│   ├── utils/accessTokenFreshness.js # Access-token freshness vs passwordChangedAt
│   ├── services/youtubeCatalogClient.js # Bounded server-side YouTube Data API client (07/43)
│   ├── services/youtubeMusicNormalizer.js # Pure YouTube candidate normalizer (08/43)
│   ├── services/catalogUpsertService.js # Idempotent YouTube catalog upsert service (09/43)
│   ├── services/catalogSyncService.js # Bounded admin catalog-sync orchestrator (10/43)
│   ├── services/listeningEventService.js # Listening interaction recording service (13/43)
│   ├── services/explicitPreferenceSignalService.js # Bounded current Favorite/Playlist evidence (17/43)
│   ├── services/userPreferenceAggregationService.js # Windowed factual user evidence profiles (18/43)
│   ├── services/trendingScoreEngine.js # Pure global Trending score engine (19/43)
│   ├── services/trendingService.js  # Authenticated Trending load/filter/fallback service (20–21/43)
│   ├── middleware/                # JWT auth, admin guard, multer upload
│   ├── routes/                    # /api/auth, /api/songs, /api/playlists, /api/history, /api/subscriptions, /api/admin, /api/listening-events, /api/trending
├── client/                        # React + Vite frontend
│   ├── src/pages/                 # One folder per page (React)
│   │   ├── Home/                  # Landing page
│   │   ├── Login/                 # Login page
│   │   ├── Signup/                # 3-step signup
│   │   ├── Dashboard/             # Music dashboard + player + Trending Now (22/43)
│   │   ├── Profile/               # User profile
│   │   ├── Playlist/              # Playlist detail page (dynamic)
│   │   ├── SongDetails/           # Song details page (dynamic)
│   │   ├── Premium/               # Premium subscription page (dynamic)
│   │   └── Admin/                 # Admin panel + login (incl. catalog-sync form, 11/43)
│   ├── src/context/               # Auth context (JWT), PlayerContext + listeningTelemetry (15–16/43)
│   ├── src/api/                   # API client
│   ├── src/hooks/                 # usePlayer (YouTube + audio fallback player)
│   └── public/                    # Static assets only (no static pages left)
├── ml/                            # Offline Python recommender foundation (23–31/43)
│   ├── requirements.txt           # numpy>=1.26,<3 + scipy>=1.12,<2 + scikit-learn>=1.5,<2
│   ├── recommender/runtime.py      # Frozen hard limits + CPU env bootstrap + pure validators
│   ├── recommender/temporal_split.py # Deterministic per-user session-level train/val/test split (24/43)
│   ├── recommender/sparse_interactions.py # Eight CSR float32 user×song factual matrices (25/43)
│   ├── recommender/content_features.py # Song×content CSR float32 categorical encoder (26/43)
│   ├── recommender/artifacts.py    # Safe versioned JSON/NPZ artifact store (27/43)
│   ├── recommender/evaluation.py   # Pure ranking evaluation metrics (28/43)
│   ├── recommender/collaborative_model.py # TruncatedSVD latent-factor model (29/43)
│   ├── recommender/hybrid_ranker.py # Deterministic known-user hybrid ranker (30/43)
│   ├── recommender/cold_start.py   # Cold-start preference + SHA-256 exploration (31/43)
│   ├── recommender/cli.py          # Bounded `runtime-info` CLI only (no train/serve)
│   ├── artifacts/                  # Local release store root (gitignored; not created by tests)
│   └── tests/                      # unittest suites (runtime + CLI + temporal + sparse + content + artifacts + evaluation + collaborative + hybrid + cold-start)
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
- Skip/replay sends share the existing serialized queue, never block playback/navigation/repeat, and have no retries or user-visible failure UI. Runtime 503 disables later listening-event sends while history remains independent. Neither skip nor same-session replay adds a PlayHistory write; a newly confirmed session records history once. Recommendation ranking and ML remain unimplemented; transparent Trending scoring lives in the pure 19/43 engine, exposed by the 20/43 authenticated API with 21/43 catalog fallback and rendered as Dashboard Trending Now (22/43) without score display or personalized AI UI.

### Current Favorite and Playlist evidence (17/43)

`server/services/explicitPreferenceSignalService.js` exposes `createExplicitPreferenceSignalService({ FavoriteModel, PlaylistModel, SongModel, UserModel })` → `getUserExplicitPreferenceSignals({ userId })`. Models have production defaults and are injected as fakes in tests. The direct trusted user ID must be an ObjectId or 24-character hexadecimal string; malformed IDs fail before any read. Because existing Favorites use `user`/`song` ObjectIds while Playlist ownership uses `user_email`, one ID-scoped User lookup reads only `_id` and `email` to resolve the persisted owner. Caller-supplied emails or nested alternate users cannot change scope. A missing User yields empty evidence; malformed persisted identity or query failure throws the fixed `Explicit preference signal loading failed` error without original persistence details.

The result is `{ signals, counts: { favorites, playlistMemberships, total }, truncated: { favorites, playlists, memberships } }`. Signals contain exactly `{ type, song_id, source_id, occurred_at }`; the frozen vocabulary is `favorite` and `playlist-membership`. Current Favorites produce explicit positive favorite evidence, deduplicated by song; within the bounded source window, the earliest valid `createdAt` wins, unknown timestamps sort last, and ties use the lowest Favorite ID. Playlist `items[{ songId, addedAt }]` are deduplicated by playlist + song, retaining the earliest known factual `addedAt`; the same song in different playlists remains separate evidence. Missing/invalid times are `null`: neither current time nor Playlist `createdAt`/`updatedAt` substitutes for membership time.

Reads are lean, projection-limited and deterministic: source documents are ordered by ascending `_id`; **1,000 Favorite rows** and **250 Playlist documents** are retained, with one extra row per read solely to detect overflow. Each fetched playlist array is projected to at most **5,001 items** (including lookahead), and at most **5,000 raw membership slots total** are inspected across retained playlists in source-ID then persisted array order. Invalid and duplicate slots consume that conservative scan budget, so `truncated.memberships` means additional membership slots went unexamined, even if fewer than 5,000 distinct signals survive. The other truncation flags report source-document overflow; flags are independent and remain set after filtering. No pagination or retries occur. Unique referenced song IDs (at most 6,000) use **one bounded, ID-only Song query**, skipped entirely when no candidates exist. Deleted/stale references are dropped; counts reflect surviving signals. Final ordering is `type`, then canonical lowercase `song_id`, then `source_id`.

Existing Favorite and Playlist state remains the source of truth: old records count automatically, and removed Favorites/memberships disappear on the next load. Removal is **not dislike** and produces no negative signal. This explicit loader excludes Post/social likes, listening events, and playback history, and supplies factual inputs to 18/43 without numeric recommendation weights or scores. No new API, write-event model, collection, route hook, or migration was added.

Run the database-free service tests from the repository root:

```bash
node --test server/services/explicitPreferenceSignalService.test.js
```

### Bounded factual user preference aggregation (18/43)

`server/services/userPreferenceAggregationService.js` exposes `createUserPreferenceAggregationService({ ListeningEventModel, SongModel, explicitPreferenceSignalService, now })` → `getUserPreferenceProfile({ userId, lookbackDays })`. Trusted IDs and options are validated before reads. Listening uses an inclusive server-`createdAt` window of **1–365 integer days, default 90**, derived from one injected clock reading. One lean projected query is scoped to that user and window, ordered by `createdAt` then `_id` ascending, and limited to **20,001 rows**; at most the earliest **20,000 rows** contribute. There is no pagination or retry.

The result contains `window`, `songs`, `genres`, `artists`, `languages`, `counts`, and `truncated`:

- Each song has `song_id`, `listening`, `explicit`, and whitelisted persisted `metadata`. Listening facts include distinct observed sessions, explicit play starts, replays, completions, skips, stops, progress-event counts, listened seconds, and latest server event time. Replay stays within its session; neither repeated appearances nor positions imply a replay, completion, or skip. A window beginning mid-session does not invent a start or reconstruct missing transitions.
- Listened seconds sum only stored finite, non-negative deltas ≤120 seconds. Invalid deltas and unexpected positive deltas on non-listening start/resume/seek/replay transitions contribute zero, while their otherwise valid event facts remain countable. Malformed IDs/sessions/types/server times, out-of-window rows, and impossible position/duration values are skipped. No position differences, seek distances, paused intervals, or timestamp gaps become listened time. `last_event_at` uses server `createdAt`, never client time.
- The 17/43 explicit service is called once with the trusted user ID. Current Favorite state/source/time and sorted distinct playlist source IDs/counts are integrated without an age cutoff. Explicit-only songs remain available for sparse/cold-start users with zero listening counters and null `last_event_at`; listening-only songs also remain. Removal of explicit evidence is not dislike.
- One additional bounded Song query fetches only IDs and the needed metadata for the unique combined references (at most 26,000). Deleted/stale references are excluded from songs, groups, and profile totals. `recommendation_eligible: false` remains factual metadata and does not erase user evidence. Persisted text is preserved; absent metadata is null. Artist/genre grouping prefers persisted normalized fields, falling back to raw fields, using trim/lowercase/whitespace collapse only as grouping keys. Language grouping uses persisted non-empty language only. Nothing is inferred from titles or categories.
- Artist, genre, and language groups contain `key`, `label`, distinct `song_count`, summed `listened_seconds`, per-song `session_count`, completion/skip/replay counts, distinct `favorite_song_count`, summed `playlist_membership_count`, and latest server `last_event_at`. Labels come from the lowest-ID contributing song. Profile `counts` contains surviving valid `listening_event_count`, `song_count`, `active_favorite_count`, `playlist_membership_count`, `total_listened_seconds`, `completed_count`, `skipped_count`, and `replay_count`.
- Songs sort by canonical song ID; groups by key; playlist IDs lexically. `truncated.listeningEvents` reports source-row overflow before validity/stale filtering. `explicitFavorites`, `explicitPlaylists`, and `explicitMemberships` propagate 17/43's independent flags, including its conservative raw-membership scan limit. Unexpected query/service failures become the fixed `User preference aggregation failed` error without the original cause.

This is read/derive-only factual aggregation: no numeric recommendation weights or scores, ranking, training, new model, persistence, API, or client behavior was added. AI recommendations are not active; transparent Trending scoring lives in the pure 19/43 engine, served by the 20/43 API with 21/43 catalog fallback and shown as Dashboard Trending Now (22/43) without personalized recommendation UI.

```bash
node --test server/services/userPreferenceAggregationService.test.js
node --check server/services/userPreferenceAggregationService.js
node --check server/services/userPreferenceAggregationService.test.js
```

### Transparent Trending score engine (19/43)

`server/services/trendingScoreEngine.js` is a **pure, deterministic** global ranking function `scoreTrendingSongs(events, options)` → ranked array (default export also exported). It has **no** Mongoose query, DB, HTTP, filesystem, network, environment read, hidden clock, personalization, or ML. Callers inject `now` and optional `limit`. **Trending is not AI** — it is a transparent ranking formula over recent aggregate Melodify playback activity.

Fixed exported constants and formula:

| Constant | Value |
|---|---|
| `TRENDING_WINDOW_HOURS` | **168** (7 days) |
| `TRENDING_HALF_LIFE_HOURS` | **24** |
| `MAX_TRENDING_EVENT_INPUTS` | **50,000** (hard input cap; over-cap throws `Trending event input exceeds limit` — never silently sliced) |
| `DEFAULT_TRENDING_LIMIT` / `MAX_TRENDING_LIMIT` | **20** / **100** (integer 1…100; 0, >100, fractions, non-numbers rejected) |
| `PLAY_STARTED_WEIGHT` | **1.0** |
| `COMPLETED_WEIGHT` | **2.0** |
| `REPLAY_STARTED_WEIGHT` | **1.5** |
| `SKIPPED_WEIGHT` | **-0.75** |
| `LISTENED_MINUTE_WEIGHT` | **0.25** |
| `UNIQUE_LISTENER_WEIGHT` | **0.5** |
| `MIN_USER_SONG_CONTRIBUTION` / `MAX_USER_SONG_CONTRIBUTION` | **-3** / **8** |

- **Window / recency:** only server `createdAt` in `[now − 168h, now]` contributes; older and future rows are ignored; `client_occurred_at` never controls recency. `trendingDecay(ageHours) = 0.5 ** (ageHours / 24)` (0h → 1, 24h → 0.5, 48h → 0.25).
- **Per-event contribution:** `(eventTypeBaseWeight + listenedMinutes × 0.25) × decay(ageHours)`. Base weights apply only to `play-started`, `completed`, `replay-started`, `skipped`; `progress`/`paused`/`resumed`/`seeked`/`stopped` get no base weight and no invented `stopped` penalty. Only stored finite `listened_seconds_delta` in **[0, 120]** counts (malformed legacy values are ignored, never clamped into validity). Position, seek distance, and wall-clock gaps never fabricate listening.
- **Per-user/song anti-spam cap:** summed decayed event contributions for each `user + song` are clamped to **[-3, 8]** (abuse-resistance / concentration-control — not ML), then the one unique-listener term is added. Each user contributes at most one `0.5 × decay(age of most recent play-started|replay-started)` term per song (`unique_listener_count` = distinct users with such a start). Repeating a song 20× does not count as 20 listeners.
- **Final score:** `max(0, sum over users of (clamp(eventSum) + uniqueListenerTerm))`. Scores are ranked at full floating-point precision, then rounded to **6 decimal places** for output only. Zero-score songs are omitted (the engine never invents fallback songs — 21/43 owns service-level catalog top-up). Tie-break order: internal score DESC → `unique_listener_count` DESC → `last_activity_at` DESC → `song_id` ASC. Identical input + `now` ⇒ deep-equal output.
- **Output rows only:** `{ song_id, score, unique_listener_count, play_started_count, completed_count, replay_started_count, skipped_count, listened_seconds, last_activity_at }` — no user/session/event IDs, emails, tokens, raw events, `recommendation_score`, or `preference_score`. Counts and `listened_seconds` are factual non-decayed totals inside the window; `last_activity_at` is the latest server `createdAt` ISO string. Malformed rows (bad user/song/type/time) are ignored without failing valid rows. Canonical IDs: ObjectId-like / 24-hex strings / populated `{ _id }` only — arbitrary objects are never stringified.
- **Not present yet:** no personalization, no Favorite/Playlist imports in ranking, no Python/ML in the engine itself. Service-level catalog fallback (21/43) lives only in `trendingService`; Dashboard now renders **Trending Now** (22/43) without score/popularity labels. **Do not label Trending as AI.**

```bash
node --test server/services/trendingScoreEngine.test.js
node --check server/services/trendingScoreEngine.js
node --check server/services/trendingScoreEngine.test.js
```

### Authenticated Trending API with catalog fallback (20–21/43)

`GET /api/trending` is mounted from `server/routes/trendingRoutes.js` (protect → `recommendationConfig.trendingEnabled` → parser → service). It is a **global** activity ranking for signed-in users; `req.user` is never passed into ranking. **Trending is not AI.**

| Topic | Behavior |
|---|---|
| Auth | `protect` only (401 without a valid token); no `adminOnly` |
| Feature flag | `RECOMMENDATION_TRENDING_ENABLED` (`true`/`1`); when off, fixed **503** `Trending is currently disabled` with zero event/engine/Song reads |
| Query | only `limit` (integer **1–50**, default **10**); any other key or malformed value → **400** `Invalid trending query` |
| Window | one injected `now`; server `createdAt` in `[now − 168h, now]`; sort `createdAt` desc, `_id` desc; lookahead **50,001** |
| Overflow | if 50,001 rows return, drop the oldest lookahead row → retain **50,000**, `meta.event_input_truncated: true`, `event_count: 50000` (never passes 50,001 to the engine) |
| Engine | exactly one `scoreTrendingSongs(events, { now, limit: 100 })` call when events exist; zero events skip the engine |
| Song load | at most one `$in` query when the engine ranked songs; drops missing docs, `recommendation_eligible === false` (legacy absent = eligible), unplayable (`youtube_id` and `file_path` both empty), and blank `title`/`artist` (shared with fallback) |
| Order / limit | engine rank order preserved through filtering; public `limit` applied last; ranks renumbered `1..N` with no gaps |
| Fallback (21/43) | if filtered activity items `< limit`, **one** additional Song query tops up from the playable eligible catalog sorted `createdAt` DESC, `_id` ASC; candidate read = `min(remaining × 3, 150)`; excludes ranked candidate IDs via `$nin` (max 100); no pagination, no second query |
| Basis / mode | each item carries `basis: "activity"` or `"catalog-fallback"`; meta `mode` ∈ `activity` \| `activity-plus-fallback` \| `catalog-fallback` plus `activity_count` / `fallback_count` (`returned_count = activity_count + fallback_count`) |
| Fallback item shape | same 12-field `song` as activity; `score: null`; activity block all zeros / `last_activity_at: null`; never invented popularity score |
| Empty | activity-only empty list is HTTP **200**; with sparse/zero activity the service still returns HTTP **200** (empty `items` only if the catalog is also empty — never 404) |
| Failure | service throws fixed `Trending loading failed` (including sanitized fallback-query failure); route returns fixed **500** `Unable to load Trending songs` (no raw DB/stack leak) |

Success body: `{ "success": true, "data": { "items": [ { "rank", "basis", "score", "activity": { unique_listener_count, play_started_count, completed_count, replay_started_count, skipped_count, listened_seconds, last_activity_at }, "song": { _id, title, artist, genre, youtube_id, file_path, poster_url, duration, duration_seconds, release_date, language, category } } ], "meta": { window_hours: 168, requested_limit, returned_count, event_count, event_input_truncated, candidate_count, mode, activity_count, fallback_count } } }`. Items never include user/session/event IDs, emails, tokens, raw Mongo documents, or internal `createdAt`. Activity items always precede fallback items; ranks stay contiguous across the combined list.

```bash
node --test server/utils/trendingRequest.test.js server/routes/trendingRoutes.test.js server/services/trendingService.test.js
node --check server/services/trendingService.js
node --check server/utils/trendingRequest.js
node --check server/routes/trendingRoutes.js
```

### Dashboard Trending Now (22/43)

Dashboard consumes authenticated `GET /api/trending?limit=10` through the existing `api` client (JWT attached automatically; no raw fetch, no `userId`/preference params, no polling, no retry loop, one request per mount with an unmount cancel guard).

| Topic | Behavior |
|---|---|
| Section order | **Recently Played → Trending Now → search → Recommended Songs** (Trending always before the discovery grid) |
| Request | single `api.get('/api/trending?limit=10')` on mount |
| Loading | section heading stays; lightweight `Loading...` status (does not block other sections) |
| Empty | section-local `No trending songs available yet.` (not labeled as an error) |
| Non-503 error | section-local `Trending is unavailable right now.` (no raw payload/stack/status/JWT) |
| Feature flag 503 | fixed backend message classified as disabled → **section hidden entirely** (no toast, no retry, Dashboard/Recently Played unaffected) |
| Normalization | pure `client/src/pages/Dashboard/trendingUi.js` — accepts only `activity` \| `catalog-fallback`, requires `_id`/`title`/`artist` + playable `youtube_id` or `file_path`, ignores malformed rows, keeps first duplicate Song ID, never reorders |
| Display | title + poster + artist only; **numeric Trending score is never shown**; fallback cards do **not** display score/listeners/plays or fabricated popularity metrics |
| Playback | `player.playSong(trendingSongs, index)` with the **full** filtered Song list (not a single-item wrapper); displayed index matches player index after filtering |
| Artwork | existing `poster_url` with shared `DEFAULT_POSTER` onError fallback |
| A11y | each card is a semantic `button`; status text uses `role="status"`; artwork has title-based alt text |
| Telemetry | click only invokes existing PlayerContext behavior — **no** Dashboard `POST /api/history` or `POST /api/listening-events` reintroduced |
| Not AI | no “Recommended For You”, AI Picks, or personalized ranking UI in this checkpoint |

```bash
node --test client/src/pages/Dashboard/trendingUi.test.js
```

### Offline Python recommender runtime foundation (23/43)

Melodify now has an offline Python recommender runtime foundation under `ml/`. It is **not** a production HTTP service (no FastAPI/Flask/Django, no resident worker, no Python microservice). Production remains React → Express/Node → MongoDB; Python is an **offline / bounded** training tool invoked later by Node orchestration.

| Topic | Behavior |
|---|---|
| Design | **CPU-only** by design (Intel i5-class, 8 GB RAM target); no CUDA/GPU/distributed/Spark assumption |
| Dependencies | **Python standard library only** in 23/43 itself — NumPy/SciPy arrive in 25/43 via `ml/requirements.txt`; scikit-learn arrives in 29/43 via `ml/requirements.txt` only; no pandas, no pymongo, no direct joblib import, no torch |
| Thread bounding | `configure_cpu_runtime()` sets process env `OMP_NUM_THREADS`, `OPENBLAS_NUM_THREADS`, `MKL_NUM_THREADS`, `NUMEXPR_NUM_THREADS`, `VECLIB_MAXIMUM_THREADS` to **`1`** and `CUDA_VISIBLE_DEVICES` to **`""`** before future numerical libraries import; idempotent; current-process only (no permanent Windows/system env, no registry, no `SETX`); numerical-library thread bound, **not** an OS-level CPU quota |
| Default seed | `DEFAULT_RANDOM_SEED = 42`; `seed_standard_library()` validates `0 <= seed <= 2**32-1` (rejects `bool`) and seeds only stdlib `random` — later numerical checkpoints must seed their own libraries |
| Hard ceilings | `MAX_RAW_EVENTS = 250000`, `MAX_UNIQUE_USERS = 50000`, `MAX_UNIQUE_SONGS = 25000`, `MAX_WORKERS = 1`, `THREADS_PER_NUMERIC_LIBRARY = 1` |
| Bounds meaning | Resource/**data-shape safety limits** for the initial 8 GB RAM CPU development workflow — **not** dataset statistics, production traffic limits, API limits, recommendation-quality parameters, or ML hyperparameters |
| Memory | **No hard OS memory quota is claimed**; safety = bounded data sizes + single worker + single numerical thread + no resident service + no third-party ML allocations yet |
| Timeout | **No in-process training timeout** in 23/43; future Node orchestration (43/43) can enforce subprocess execution time limits |
| Config object | `@dataclass(frozen=True) RuntimeLimits` via `get_runtime_limits()` — immutable authoritative defaults (not a mutable module-global dict) |
| Validation | Pure helpers `validate_non_negative_count` / `ensure_within_limit` / `validate_dataset_shape` — integer only (`bool`/`float` rejected), `>= 0`, hard-cap enforced; package-specific `ResourceLimitError` / `RuntimeConfigError` with deterministic bounded messages (no env dumps/tokens/DB URLs) |
| Import safety | Importing `ml.recommender.runtime` does **not** query MongoDB, read/write files, or auto-configure env; bootstrap runs explicitly via `configure_cpu_runtime()` / CLI main |
| CLI | argparse only — single command `runtime-info` (optional `--json`); **no** `train` / `evaluate` / `recommend` / `snapshot` / `serve` yet |
| `runtime-info` | Deterministic summary (`runtime`, `cpu_only: true`, seed/caps/workers/threads, `runtime_schema_version`); stdout only; **no** timestamp, username, computer name, home/repo path, env dump, or secrets; no file artifacts (`.pkl`/`.npy`/`.csv`/logs) |
| Not present yet | No SVD/collaborative ranking in 23/43 itself, no MongoDB reads, model artifacts, or recommendation snapshots — evaluation metrics arrive in **28/43**, collaborative SVD in **29/43** |
| AI status | **No model trained**; AI recommendations remain **not active**; do not claim GPU support or OS-hard-capped memory |

```bash
python -m unittest discover -s ml/tests -p "test_*.py"
python -m ml.recommender.cli runtime-info --json
python -m compileall -q ml/recommender ml/tests
```

### Time-aware raw interaction split (24/43)

`ml/recommender/temporal_split.py` exposes `split_interactions_temporally(events)` — a deterministic, leakage-resistant chronological splitter for in-memory ListeningEvent-like records. Standard library only; no randomness, no current-time dependency, no file/DB/HTTP access.

| Topic | Behavior |
|---|---|
| Split unit | **Per user**, not one global timestamp; each user has an independent chronological session timeline |
| Session indivisibility | One `(user_id, session_id)` group belongs to **exactly one** partition (train **or** validation **or** test) |
| Holdouts | `VALIDATION_SESSIONS_PER_USER = 1`, `TEST_SESSIONS_PER_USER = 1`, `MIN_TRAIN_SESSIONS_PER_EVALUATED_USER = 1` → `MIN_SESSIONS_FOR_EVALUATION = 3` |
| Evaluable user (≥3 non-overlapping sessions) | earliest sessions → train; second-latest → validation; latest → test (e.g. 5 sessions: 1–3 train, 4 validation, 5 test) |
| Sparse users (1–2 sessions) | **all events train-only**; no validation/test contribution |
| Overlapping sessions | if any adjacent sorted sessions have `previous.session_end_at > next.session_start_at`, the whole user is **train-only** and `overlap_train_only_user_count` increments; other users unaffected |
| Equal boundary timestamps | `previous.end == next.start` is **not** overlap (only strict `>`) |
| Chronology authority | **server `createdAt` only** (timezone-aware datetime or ISO-8601 with offset/`Z`); normalized to UTC |
| `client_occurred_at` | **ignored** for split ordering (may exist on input; never used) |
| Event order within session | `created_at ASC`, then `sequence ASC`, then `event_id ASC` (input order never matters) |
| Session order | `session_start_at ASC`, `session_end_at ASC`, `session_id ASC` |
| Final partition order | `created_at ASC`, `user_id ASC`, `session_id ASC`, `sequence ASC`, `event_id ASC` |
| Event vocabulary | fixed 9-type server set: `play-started`, `progress`, `paused`, `resumed`, `seeked`, `completed`, `skipped`, `stopped`, `replay-started` — unknown types reject |
| IDs | 24-hex for `_id`/`user`/`song`, normalized lowercase; `session_id` trimmed non-empty ≤128 chars (not lowercased) |
| Sequence | integer `0..1_000_000`, `bool` rejected; gaps allowed; sequence 0 not required; duplicate sequence in a session rejects |
| Duplicate event `_id` | **reject** (even byte-identical rows) |
| Multi-song session | **reject** (`session contains multiple song ids`) |
| `listened_seconds_delta` | optional; if present: finite number in `[0, 120]`, `bool`/NaN/Inf rejected; never used for split decisions |
| Same song across splits | **allowed** — 24/43 splits time, not unique items |
| Runtime caps | reuses 23/43 `MAX_RAW_EVENTS` / `MAX_UNIQUE_USERS` / `MAX_UNIQUE_SONGS`; overflow raises `ResourceLimitError` — **no silent truncation** |
| Result | frozen `TemporalSplitResult(train, validation, test, summary)` with frozen event/summary dataclasses and tuple partitions |
| Count invariants | `input = train + validation + test` events; `session_count = train + validation + test` sessions |
| Not present yet | no sparse matrix in 24/43 itself, no interaction weighting, SVD, collaborative/content ranking, evaluation metrics, MongoDB, model artifacts, or snapshots — **25/43** builds the bounded sparse interaction representation |

```bash
python -m unittest discover -s ml/tests -p "test_*.py"
python -m unittest ml.tests.test_temporal_split
```

### Bounded sparse interaction matrices (25/43)

`ml/recommender/sparse_interactions.py` exposes `build_sparse_interactions(events)` — converts a list or tuple of 24/43 `TemporalInteractionEvent` records into eight deterministic CSR `float32` user×song matrices under 23/43 hard caps. NumPy/SciPy are loaded lazily after `configure_cpu_runtime()` so importing the module alone does not mutate process env. Only new project dependency surface is `ml/requirements.txt` (`numpy>=1.26,<3`, `scipy>=1.12,<2`).

| Topic | Behavior |
|---|---|
| Input | list/tuple of `TemporalInteractionEvent` only — raw dicts, strings, bytes, mappings, generators, and arbitrary objects reject |
| Matrices (all CSR `float32`, shape `(n_users, n_songs)`) | `observed` binary presence; `session_count` distinct session count; `play_started_count`; `replay_started_count`; `completed_count`; `skipped_count` **positive** count (never negative/penalty); `stopped_count`; `listened_seconds` sum of stored `listened_seconds_delta` only |
| Canonical CSR | `sum_duplicates()` + `eliminate_zeros()` + `sort_indices()` on every matrix |
| Index order | `user_ids`/`song_ids` = `tuple(sorted(unique_ids))`; `user_to_index`/`song_to_index` exposed as `types.MappingProxyType` (read-only) |
| Support events | `progress` / `paused` / `resumed` / `seeked` contribute only to `observed`, `session_count`, and `listened_seconds` (stored delta) — no own count matrices, no inferred weights |
| Weight/preference matrices | **none** — no `PLAY_WEIGHT`/`COMPLETE_WEIGHT`/`SKIP_PENALTY`/`REPLAY_WEIGHT`/`PREFERENCE_WEIGHT`; scoring belongs to later checkpoints |
| Dense allocation | **none** for the interaction space (no `.toarray()`/`.todense()`/`np.zeros((n_users, …))`) — pair accumulators bounded by event count only |
| Empty input | `[]` / `()` → valid empty bundle: zero-length ID tuples, shape `(0,0)`, eight empty CSR matrices, zeroed summary |
| Defensive validation | canonical lowercase 24-hex IDs, non-empty `session_id` ≤128, non-bool int sequence, fixed 9-type vocabulary, `listened_seconds_delta` `None` or finite `[0,120]`, tz-aware `created_at`; reject duplicate `event_id`, duplicate session sequence (gaps OK), multi-song session per `(user, session)` |
| Caps | reuses 23/43 `MAX_RAW_EVENTS` / `MAX_UNIQUE_USERS` / `MAX_UNIQUE_SONGS` via `validate_dataset_shape` — overflow raises `ResourceLimitError`, **no silent truncation** |
| Result | frozen `SparseInteractionBundle(user_ids, song_ids, user_to_index, song_to_index, 8 matrices, summary)` + frozen `SparseInteractionSummary(event_count, unique_user_count, unique_song_count, interaction_pair_count, session_count, matrix_shape)` |
| No re-split | does not call `split_interactions_temporally`; partitions arrive already decided by 24/43 |
| Not present yet | no Favorite/Playlist folding, SVD, model training, MongoDB/HTTP, or artifact files (`.npz`/`.npy`/`.pkl`/`.joblib`) in 25/43 itself — content encoding arrives in **26/43**, collaborative SVD in **29/43** |

```bash
python -m pip install -r ml/requirements.txt
python -m pip check
python -m unittest discover -s ml/tests -p "test_*.py"
python -m unittest ml.tests.test_sparse_interactions
```

### Sparse Song content features (26/43)

`ml/recommender/content_features.py` exposes `build_song_content_features(songs)` and pure helper `normalize_content_value(value)` — deterministic binary categorical encoding of Song catalog metadata into one CSR `float32` matrix under 23/43 caps. NumPy/SciPy still load lazily after `configure_cpu_runtime()`; `ml/requirements.txt` is unchanged from 25/43.

| Topic | Behavior |
|---|---|
| Feature families | exactly `CONTENT_FEATURE_FAMILIES = ("artist", "genre", "language", "category")` |
| Metadata fields read | `artist`, `genre`, `language`, `category`, `normalized_artist`, `normalized_genre` only (plus required `_id`) |
| Title / lyrics / chords / duration / popularity / provider / YouTube / paths / timestamps | **not encoded** |
| Normalization | one pure policy: Unicode **NFKC** → trim → collapse internal whitespace to one ASCII space → Unicode **casefold()**; no transliteration, stemming, accent removal, punctuation stripping, or tokenization |
| `MAX_CONTENT_VALUE_LENGTH` | **512** code points after normalization — longer values **reject** (no silent truncation) |
| `normalized_artist` / `normalized_genre` | non-empty normalized value wins; otherwise fall back only to persisted `artist` / `genre`; never both for one family |
| Language / category | persisted values only when non-empty; **no** inference from title/artist/genre/provider/script |
| Multi-value strings | **not split** on `,` `/` `&` `;` `feat.`/`ft.` — one persisted string is one categorical value |
| Placeholders (`Unknown`, `N/A`) | encoded as factual normalized values (e.g. `genre::unknown`) — no special suppression |
| Feature names | namespaced `artist::<value>`, `genre::<value>`, `language::<value>`, `category::<value>` (families never collide) |
| Feature values | binary **`1.0`** only — no `ARTIST_WEIGHT` / `GENRE_WEIGHT` / content scores |
| Song rows | `song_ids = tuple(sorted(canonical_ids))`; uppercase hex IDs normalized lowercase; duplicate canonical `_id` **rejects** |
| Feature columns | `feature_names = tuple(sorted(unique_names))` lexicographic ASC |
| Index maps | `song_to_index` / `feature_to_index` are `types.MappingProxyType` (immutable) |
| `MAX_CONTENT_FEATURES` | derived: `MAX_UNIQUE_SONGS * len(CONTENT_FEATURE_FAMILIES)` = **100_000** — overflow raises `ResourceLimitError` |
| Input | list/tuple of mapping-like Song records only; `len(songs) > MAX_UNIQUE_SONGS` raises `ResourceLimitError` before processing |
| Zero-feature Songs | retained as zero rows (`zero_feature_song_count`); all-zero catalog keeps shape `(n, 0)` — never collapses to `(0, 0)` |
| Empty input | `[]` / `()` → shape `(0, 0)`, CSR `float32`, `nnz = 0`, zeroed summary |
| Matrix | one CSR `float32` Song×Feature matrix; `sum_duplicates` + `eliminate_zeros` + `sort_indices`; every active value `1.0` |
| Dense / Song×Song | **none** — no `.toarray()`, `.todense()`, `np.zeros`, cosine similarity, or nearest-neighbor retrieval |
| Not present yet | no TF-IDF, recommendation/preference scores, model fitting/SVD, MongoDB/HTTP, Favorite/Playlist folding, `recommendation_eligible` filtering, or artifact writes — **27/43** establishes safe model/artifact version handling |

```bash
python -m unittest discover -s ml/tests -p "test_*.py"
python -m unittest ml.tests.test_content_features
```

### Safe recommender artifact store (27/43)

`ml/recommender/artifacts.py` is a pure local filesystem store for bounded offline recommender outputs. Public API: `publish_artifact_release()`, `verify_artifact_release()`, `activate_artifact_release()`, `resolve_active_artifact_release()`, `load_json_artifact()`, `load_numeric_npz_artifact()`, plus `encode_json_artifact` / `decode_json_artifact` / `encode_numeric_npz` / `decode_numeric_npz` and the `ArtifactError` hierarchy. **No model is trained and no release exists in the repository** — tests create temporary stores only.

| Topic | Behavior |
|---|---|
| Schema | `ARTIFACT_SCHEMA_VERSION = 1`; `current.json` payload is `{ schema_version, artifact_version }` |
| Layout | `root/releases/<version>/{manifest.json, payload files…}` + optional `root/current.json` + `.staging/` during publish |
| Identifiers | versions/kinds: `^[a-z0-9][a-z0-9._-]{0,63}$` (reject `.` / `..`); filenames ≤128 chars, same charset, must end `.json` or `.npz`; reserved: `manifest.json`, `current.json` |
| Manifest | sorted-by-name file records `{ name, format, size_bytes, sha256 }`; no self-hash; no absolute paths / host / secrets |
| Publish | validate → stage in `.staging/` → write payloads + manifest → fully verify staged dir → `os.replace` into `releases/<version>`; existing version ⇒ `ArtifactConflictError` (immutable, no merge); **never** writes `current.json` |
| Activation | verify candidate first → temp file + fsync → `os.replace` onto `current.json`; failed verification or pointer write leaves previous pointer bytes unchanged |
| Resolve | no pointer ⇒ `None`; pointer present ⇒ full release verification; **no** auto-latest scanning |
| JSON codec | deterministic UTF-8, sorted keys, compact separators, `allow_nan=False`; decode rejects non-UTF-8, bare `NaN`/`Infinity`, malformed JSON |
| NPZ codec | `allow_pickle=False` only; dtypes limited to bool/int/uint/float; all float values finite; array names `^[a-z_][a-z0-9_]{0,63}$`; ZIP inspected with stdlib `zipfile` (entry count, uncompressed size, absolute/`..`/drive paths) **before** `np.load`; never extracts to filesystem; returned arrays are read-only copies in a `MappingProxyType` |
| Limits | `MAX_ARTIFACT_FILES=32`, `MAX_ARTIFACT_FILE_BYTES=64 MiB`, `MAX_ARTIFACT_TOTAL_BYTES=128 MiB`, `MAX_METADATA_ENTRIES=64`, `MAX_METADATA_JSON_BYTES=64 KiB`, `MAX_NPZ_ARRAYS=64`, `MAX_NPZ_UNCOMPRESSED_BYTES=256 MiB`, `MAX_NPZ_ZIP_ENTRIES=128` |
| Metadata | flat scalars only (str / int / finite float / bool / None); keys ≤128 chars; nested objects/lists rejected |
| Safety | rejects symlink release dirs / manifests / payloads, undeclared extra files or directories, executable suffixes (`.pkl` `.pickle` `.joblib` `.pt` `.pth` `.onnx` `.exe` `.dll` `.py`); no pickle/joblib/eval/exec/subprocess/model fitting/MongoDB/HTTP/cloud |
| NumPy loading | module import does not configure env or import NumPy; `_load_numpy()` calls `configure_cpu_runtime()` first; JSON-only paths never import NumPy |
| Not present yet | no model training, evaluation metrics, MongoDB/HTTP/UI, cloud durability guarantees, or auto-activation — **28/43** adds recommender evaluation metrics |

```bash
python -m unittest discover -s ml/tests -p "test_*.py"
python -m unittest ml.tests.test_artifacts
```

### Recommender evaluation metrics (28/43)

`ml/recommender/evaluation.py` exposes pure `evaluate_recommendations(recommendations_by_user, relevant_by_user, catalog_song_ids, content_features)` plus per-metric helpers (`precision_at_k`, `recall_at_k`, `ndcg_at_k`, `average_precision_at_k`, `hit_at_k`, `catalog_coverage_at_k`, `intra_list_diversity_at_k`). It **measures** caller-supplied ranked recommendations against caller-provided held-out relevance and catalog — it does not generate recommendations, train models, query MongoDB, write artifacts, or infer relevance from playback event types.

| Topic | Behavior |
|---|---|
| Metrics | `PRECISION_RECALL_KS = (5, 10)`, `NDCG_KS = (5, 10)`, `MAP_K = 10`, `HIT_RATE_K = 10`, `COVERAGE_K = 10`, `DIVERSITY_K = 10` |
| Precision@K | hits in top-K / **K** (denominator always K; short lists are penalized) |
| Recall@K | hits in top-K / \|relevant\| (requires non-empty relevance) |
| NDCG@K | binary relevance; DCG = Σ 1/log2(rank+1) over hits ≤K; IDCG = Σ 1/log2(rank+1) for rank 1..min(K,\|relevant\|) |
| MAP@10 | mean Average Precision@10; AP = Σ Precision@rank over hits ≤10 / min(\|relevant\|, 10); 0 if no hit |
| Hit Rate@10 | 1.0 if ≥1 relevant Song in top 10, else 0.0 |
| Catalog Coverage@10 | unique top-10 recommended Songs across evaluable users / \|catalog\|; relevance is **not** required to count toward coverage |
| Diversity@10 | mean intra-list pairwise cosine **dissimilarity** over top-10 pairs where both Songs have non-zero content vectors; sparse CSR row access only (`getrow`/`multiply`/`sum`); zero-feature pairs are **excluded** from the denominator (never diversity=1); global diversity = mean of per-user diversities over users with ≥1 scorable pair (equal user weight) |
| Macro averaging | all user metrics average over **evaluable** users only (non-empty relevance set); sorted ascending by canonical user ID for deterministic aggregation |
| Empty relevance / missing recs | empty relevance ⇒ user not evaluable; missing recommendations for an evaluable user ⇒ empty ranked list (all-zero metrics for that user) |
| Zero evaluable users | every metric returns `0.0` (never `NaN`/`None`); summary counts remain factual |
| Catalog membership | every relevant Song and every recommended Song of an evaluated user must be in the catalog else `EvaluationValidationError`; empty catalog with non-empty relevance rejects |
| Content alignment | every catalog Song must exist in the 26/43 bundle `song_to_index` (including zero-feature Songs) else `content feature catalog is misaligned`; extra bundle Songs allowed |
| Caps | `MAX_RECOMMENDATIONS_PER_USER = 100`; total unique users ≤ `MAX_UNIQUE_USERS` (50 000); catalog size ≤ `MAX_UNIQUE_SONGS` (25 000); overflow ⇒ `ResourceLimitError` (no truncation) |
| IDs | user and Song IDs are canonical 24-hex (lowercased after trim); duplicate recommendation Songs reject (no silent dedup); list/tuple relevance/catalog duplicates reject; set/frozenset relevance and catalog accepted |
| Result | frozen `RecommenderEvaluationResult` (10 metric floats + nested frozen `RecommenderEvaluationSummary`); no internal rounding; values finite in [0.0, 1.0] |
| Not present | no overall/combined score, no model training/generation in 28/43 itself, no SVD/CF/content ranking, no MongoDB/HTTP/artifact writes, no relevance inference from `TemporalInteractionEvent`/`ListeningEvent`/`Favorite`/`Playlist`, no dense Song×Song matrix |
| Next | **29/43** adds a collaborative latent-factor model that these metrics can evaluate; **30/43** adds deterministic hybrid ranking |

```bash
python -m unittest discover -s ml/tests -p "test_*.py"
python -m unittest ml.tests.test_evaluation
python -m compileall -q ml/recommender ml/tests
```

### Collaborative latent-factor model (29/43)

`ml/recommender/collaborative_model.py` exposes `build_collaborative_training_signal(bundle)`, `train_collaborative_model(bundle, *, n_components=DEFAULT_LATENT_FACTORS, random_seed=DEFAULT_RANDOM_SEED)`, and `score_collaborative_candidates(model, user_id, candidate_song_ids)`. It turns a 25/43 sparse interaction bundle into a fixed-formula implicit-signal matrix, fits deterministic truncated SVD when enough data exists, and returns raw latent-factor scores. Coefficients are an **initial heuristic policy** — not learned weights, not an optimized configuration, and not a quality claim. Explained-variance ratio is a factual SVD diagnostic only, not an accuracy measure. No model is trained on production data in this checkpoint; no artifact release exists in the repository.

| Topic | Behavior |
|---|---|
| Formula | `signal = clip(1.00·observed + 0.50·log1p(session_count) + 0.25·log1p(play_started_count) + 1.50·log1p(completed_count) + 1.00·log1p(replay_started_count) + 0.25·log1p(listened_seconds/60.0) − 0.75·log1p(skipped_count), 0.0, 8.0)` |
| Exported weights | `OBSERVED_WEIGHT=1.00`, `SESSION_LOG_WEIGHT=0.50`, `PLAY_START_LOG_WEIGHT=0.25`, `COMPLETION_LOG_WEIGHT=1.50`, `REPLAY_LOG_WEIGHT=1.00`, `LISTENED_MINUTE_LOG_WEIGHT=0.25`, `SKIP_LOG_PENALTY=0.75`, `MAX_IMPLICIT_SIGNAL=8.0` |
| Damping / clip | every count/listen term uses `numpy.log1p`; listened seconds converted to minutes (`/60.0`) before `log1p`; final values clipped to `[0, 8]`; only `skipped_count` subtracts |
| `stopped_count` | **no coefficient** — deliberately neutral (ambiguous route-change/logout/error/abandonment semantics); 25/43 matrix still preserved |
| Heuristic vs learned | coefficients are a fixed initial policy to be judged later via the 28/43 evaluation pipeline — never described as best/optimal/learned weights |
| Signal format | canonical CSR `float32`, finite, non-negative, sorted indices, explicit zeros eliminated; input bundle never mutated |
| SVD | `sklearn.decomposition.TruncatedSVD` with `algorithm=SVD_ALGORITHM="randomized"`, `n_iter=SVD_N_ITER=7`, `random_state=random_seed`; lazy import after `configure_cpu_runtime()` (OMP/OpenBLAS/MKL/NumExpr/VecLib threads=1, `CUDA_VISIBLE_DEVICES=""`) |
| Factors | default/max `DEFAULT_LATENT_FACTORS=MAX_LATENT_FACTORS=32`; `effective_components = min(requested, user_count−1, song_count−1)` (≥1 when training proceeds) |
| Seed | reuses 23/43 validation: non-bool int in `[0, 2**32−1]`; default `42`; same bundle+seed ⇒ byte-identical factor arrays |
| Insufficient data | users &lt; 2 **or** songs &lt; 2 **or** interaction pairs &lt; 2 **or** signal `nnz == 0` ⇒ `status="insufficient-data"`, `model=None`, `explained_variance_ratio_sum=None` — no exception, no fabricated factors |
| Status vocabulary | exactly `"trained"` \| `"insufficient-data"` |
| Model | frozen `CollaborativeLatentModel`: schema version 1, sorted ID tuples, `MappingProxyType` maps, read-only `float32` `user_factors` (U·Σ from `fit_transform`) / `song_factors` (`components_.T`) / `singular_values` / `explained_variance_ratio`, requested+effective components, seed, algorithm, n_iter |
| Summary | frozen `CollaborativeTrainingSummary`: user/song/pair counts, signal nnz, requested/effective components, seed, status, `explained_variance_ratio_sum: float \| None` (factual diagnostic only — no quality label/verdict/accuracy claim) |
| Scoring | `score_collaborative_candidates` returns `tuple[CollaborativeItemScore, …]` in **exact input order**; raw `user_factor · song_factor` dot (may be negative/zero/positive); **not** probability/rating/confidence; no clip/sigmoid/min-max, no rank sort, no seen-song filtering, no content features |
| Score validation | model must be `CollaborativeLatentModel`; candidates list/tuple only (set/generator/mapping reject); ≤ `MAX_UNIQUE_SONGS`; canonical lowercase 24-hex; duplicates reject; unknown user ⇒ `CollaborativeUnknownUserError`; unknown song ⇒ `CollaborativeUnknownSongError` |
| Memory | no `.toarray()`/`.todense()`/`np.zeros((n_users, …))`; no `user_factors @ song_factors.T` full reconstruction — only per-candidate dots bounded by `candidate_count × effective_components` |
| Dependencies | `ml/requirements.txt` adds exactly `scikit-learn>=1.5,<2` (installed 1.9.1) alongside existing `numpy>=1.26,<3` and `scipy>=1.12,<2`; no pandas / direct joblib / torch / tensorflow / implicit / surprise / lightfm |
| CLI | `runtime-info` remains the only command — **no** `train` / `fit` / `svd` / `recommend` subcommand |
| Not present | no Favorite/Playlist/content-feature folding, no evaluation-based hyperparameter search, no artifact publish/activate, no MongoDB/HTTP |
| Next | **30/43** adds deterministic hybrid ranking over these collaborative scores |

```bash
python -m pip install -r ml/requirements.txt
python -m pip check
python -m unittest discover -s ml/tests -p "test_*.py"
python -m unittest ml.tests.test_collaborative_model
python -m compileall -q ml/recommender ml/tests
python -m ml.recommender.cli runtime-info --json
```

### Deterministic hybrid ranker (30/43)

`ml/recommender/hybrid_ranker.py` exposes `prepare_hybrid_ranker(collaborative_model, interaction_bundle, content_features)` and `rank_hybrid_candidates(context, user_id, candidate_song_ids, *, limit=DEFAULT_HYBRID_LIMIT)`. It ranks an explicit candidate list for **one known user** by blending 29/43 raw collaborative scores with 26/43 sparse content cosine. Weights are a **fixed initial baseline** — not learned, not optimized, not a quality claim — and the public API accepts no caller-supplied weights.

| Topic | Behavior |
|---|---|
| Weights | `COLLABORATIVE_WEIGHT=0.70`, `CONTENT_WEIGHT=0.30` (sum invariant 1.0); no `alpha`/`beta`/weight parameters on the public API |
| Prepare | exact model↔bundle user/song ID tuple + map alignment; every model Song must exist in the content bundle (extra content Songs allowed); training signal built **exactly once** via 29/43 `build_collaborative_training_signal` (formula not duplicated) and stored read-only; one finite read-only `float32` L2 norm per content row; inputs never mutated |
| Known users only | invalid 24-hex ⇒ `HybridValidationError`; well-formed but unknown user ⇒ `HybridColdStartUserError` (**no cold-start fallback — future 31/43**) |
| Candidates | list/tuple only (set/generator/mapping/string/bytes reject); canonical lowercase 24-hex; duplicates reject (no silent dedup); count ≤ `MAX_HYBRID_CANDIDATES` (`MAX_UNIQUE_SONGS`) else `ResourceLimitError` (no truncation); unknown candidate Song ⇒ `HybridColdStartSongError` |
| Seen filter | seen iff `observed[user, song] > 0` (only `observed` — not session/completion/skip counts); applied **before** the single `score_collaborative_candidates()` call; all-seen or empty input ⇒ valid empty result with no scorer call and factual `seen_filtered_count` |
| Collaborative normalization | candidate-set-local min-max of raw scores: `(raw − min) / (max − min)` when `max > min`; all equal (including a single candidate) ⇒ **`0.50` neutral**; **not** a probability/confidence/rating/globally calibrated value — ranking normalization only |
| Content profile | sparse dict accumulator: for each positive 29/43 training-signal entry, add `weight × content[song, feature]`; **no** per-source-Song normalization; **no** Favorite/Playlist/18/43 Node profile; `profile_norm = √(Σ value²)` (0 if empty) |
| Content score | sparse cosine `dot / (profile_norm × candidate_norm)` clamped to [0,1] for float drift; **unavailable (`None`)** when profile norm is 0 **or** candidate row norm is 0 (zero-feature Song) — never pretend 0 similarity or max dissimilarity |
| Hybrid formula | content available ⇒ `0.70·collab_norm + 0.30·content`; content `None` ⇒ **`hybrid = collab_norm`** (full weight, **no ×0.70 penalty**, no fabricated content); all hybrid scores finite in [0,1] |
| Sort order | hybrid DESC → collaborative normalized DESC → collaborative raw DESC → content DESC (**missing content below any numeric**) → **song ID ASC** (final tie-break; input order never decides ties); full precision before sort; then apply `limit`; ranks contiguous `1..N` |
| Limit | default `DEFAULT_HYBRID_LIMIT=20`, max `MAX_HYBRID_LIMIT=100`; int only (`bool` rejected); **not** required to be ≤ candidate count (fewer eligible ⇒ fewer items) |
| Item | frozen `HybridRankedItem`: `rank`, `song_id`, `hybrid_score`, `collaborative_raw_score`, `collaborative_normalized_score`, `content_score: float \| None`, `content_available` — no field named confidence/probability/rating/accuracy |
| Result / summary | frozen `HybridRankingResult` (items tuple + summary); frozen `HybridRankingSummary`: `input_candidate_count`, `seen_filtered_count`, `eligible_candidate_count`, `returned_count`, `requested_limit`, `content_profile_feature_count`, `content_available_candidate_count` (before limit truncation), `collaborative_weight`, `content_weight` |
| Errors | `HybridRankingError` → `HybridValidationError`, `HybridColdStartUserError`, `HybridColdStartSongError` (all under `RecommenderRuntimeError`); candidate cap overflow ⇒ `ResourceLimitError`; bounded messages only |
| Memory / scope | sparse only (no `.toarray()`/`.todense()`); no dense user×song or Song×Song; no training/SVD/evaluation calls/artifact publish/MongoDB/HTTP; no cold-start fallback, exploration, or random tie-break; `ml/requirements.txt` unchanged |
| Lazy import | importing the module does **not** call `configure_cpu_runtime()` and does **not** import NumPy/SciPy; numeric stack loads only inside prepare/rank after `configure_cpu_runtime()` |
| CLI | `runtime-info` remains the only command |
| Not present | cold-start fallback (done in 31/43 above), snapshot/artifact publication, retraining, HTTP/MongoDB, Dashboard changes |
| Next | **31/43** owns cold-start / fallback / explicit-evidence policy for users and Songs this ranker rejects (implemented) |

```bash
python -m unittest discover -s ml/tests -p "test_*.py"
python -m unittest ml.tests.test_hybrid_ranker
python -m compileall -q ml/recommender ml/tests
python -m ml.recommender.cli runtime-info --json
```

### Cold-start preference and exploration policy (31/43)

`ml/recommender/cold_start.py` exposes `normalize_explicit_preference_profile(profile)` and `rank_with_cold_start_policy(hybrid_context, user_id, candidate_song_ids, *, explicit_profile=None, limit=DEFAULT_POLICY_LIMIT)`. It is the policy layer **above** the 30/43 hybrid ranker: known users reuse hybrid exploitation (exactly one hybrid call), unknown users and collaborative-unseen Songs fall back to explicit profile matching and/or deterministic SHA-256 exploration — never fabricated collaborative scores, never a popularity fallback.

| Topic | Behavior |
|---|---|
| Public API | `normalize_explicit_preference_profile` → frozen `ExplicitPreferenceProfile`; `rank_with_cold_start_policy` → frozen `ColdStartRankingResult` (items + summary); **no** weight/`alpha`/`beta`/interval parameters |
| Profile input | `None` → valid empty profile; else mapping with **only** `favorite_song_ids` (list/tuple, canonical 24-hex, duplicates reject, no set/generator/string), `playlist_song_counts` (song→int `1..250`), `artist_counts`/`genre_counts` (text→int `1..1_000_000`); unknown keys reject; `bool` counts reject; keys normalized with 26/43 `normalize_content_value` (collapse-dup keys reject) |
| Profile caps | `MAX_PROFILE_FAVORITE_SONGS=1000`, `MAX_PROFILE_PLAYLIST_SONGS=5000`, `MAX_PROFILE_ARTIST_ENTRIES=5000`, `MAX_PROFILE_GENRE_ENTRIES=5000` — overflow ⇒ `ResourceLimitError`, **no silent truncation** |
| Profile evidence units | Favorite Song = **+1 unit** per applicable content feature; Playlist Song = **+membership count** units; same Song both = `1 + count`; **no** `FAVORITE_WEIGHT`/`PLAYLIST_WEIGHT` multipliers |
| Family precedence | non-empty `artist_counts` **replaces** source-Song `artist::*` contributions (same for `genre_counts`/`genre::*`); language/category only from source Song rows; out-of-vocabulary aggregate keys ignored; source Song missing from content bundle keeps its ID in the normalized profile but skips the content row |
| Profile vector / cosine | sparse `dict[feature_index, float]` (never a dense `np.zeros` vector); `profile_norm = √(Σ value²)` (0 if empty); cosine `dot/(profile_norm×candidate_norm)` clamped [0,1]; **`None`** when profile or candidate row norm is 0 (never fabricated 0/negative/confidence) |
| Known vs cold-start user | canonical user in `collaborative_model.user_to_index` ⇒ known (hybrid reused **exactly once** with remaining collaborative-known IDs, `limit=MAX_HYBRID_LIMIT`); unknown user ⇒ **0 hybrid calls**, **not an error** |
| Candidates | list/tuple only; canonical 24-hex; duplicates reject; count ≤ `MAX_UNIQUE_SONGS` else `ResourceLimitError`; every candidate must exist in 26/43 content (zero-feature row valid) else `ColdStartValidationError` (`candidate song is outside content catalog`); collaborative-unseen Song is **not** an error; zero-feature Songs remain **exploration-eligible** |
| Filter order | content membership → explicit profile source Song IDs (favorites ∪ playlist keys) → known-user `observed>0` seen → collaborative-known vs cold-start Song split |
| Policy weights | `BASE_HYBRID_POLICY_WEIGHT=0.80`, `EXPLICIT_PROFILE_POLICY_WEIGHT=0.20` (sum invariant 1.0; **fixed initial baseline**, not learned/optimized; public API accepts no weight parameters) |
| Policy formulas | both scores ⇒ `0.80·hybrid + 0.20·profile` (`basis="hybrid-profile"`); hybrid only ⇒ **full hybrid** (`basis="hybrid"`, **no ×0.80 penalty**); profile only ⇒ **full profile** (`basis="profile"`); neither ⇒ exploration-eligible only (no exploitation score) |
| Exploitation sort | policy score DESC → hybrid DESC (None last) → profile DESC (None last) → **song ID ASC**; full precision before sort |
| Exploration order | SHA-256 digest of `melodify-exploration-v1\|<user_id>\|<song_id>` (UTF-8); sort digest ASC → song ID ASC; **no** built-in `hash(`, **no** wall clock, **no** randomness; hash is **ordering only** — never exposed as score/probability/confidence |
| Cadence / slots | `EXPLORATION_INTERVAL=5`; ranks `5,10,15,…` prefer the exploration pool, other ranks prefer exploitation; `target_exploration_slots = floor(limit/5)` (L=20→4, L=100→20); empty preferred pool **backfills** from the other pool; no duplicate Song IDs |
| Item | frozen `ColdStartRankedItem`: `rank`, `song_id`, `basis` ∈ {`hybrid`,`hybrid-profile`,`profile`,`exploration`}, `policy_score: float\|None` (**`None` iff basis=`exploration`**), `hybrid_score: float\|None`, `profile_score: float\|None`, `collaborative_known: bool` — **no** confidence/probability/rating/accuracy field |
| Result / summary | frozen `ColdStartRankingResult`; frozen `ColdStartRankingSummary`: `input_candidate_count`, `profile_source_excluded_count`, `seen_excluded_count`, `eligible_candidate_count`, `collaborative_known_candidate_count`, `cold_start_song_candidate_count`, `profile_feature_count`, `exploitation_selected_count`, `exploration_selected_count`, `returned_count`, `requested_limit`, `collaborative_known_user`, `profile_available` — factual counts only, no quality verdict |
| Errors | `ColdStartPolicyError` → `ColdStartValidationError` (both under `RecommenderRuntimeError`); candidate cap overflow ⇒ `ResourceLimitError`; unknown user/Song are **not** errors; bounded messages only |
| Memory / scope | pure Python (no NumPy/SciPy import at module load; no `configure_cpu_runtime()` on import); no dense profile or Song×Song; no SVD/evaluation/artifact/DB/HTTP; no JS/Node service imports; no popularity/Trending fallback; `ml/requirements.txt` unchanged |
| Bridge vs coupling | accepts **compatible plain-data preference evidence** (favorite IDs, playlist counts, artist/genre aggregates) prepared by the caller — **not** direct Node/Python service coupling, not a MongoDB read, not a duplicate of 17/18/43 loaders |
| Not present | evaluation-run persistence/snapshot publication (32/43), retraining, HTTP/MongoDB/CLI ranking command, Dashboard UI changes |
| Next | **32/43** persists evaluation-run history |

```bash
python -m unittest discover -s ml/tests -p "test_*.py"
python -m unittest ml.tests.test_cold_start
python -m compileall -q ml/recommender ml/tests
python -m ml.recommender.cli runtime-info --json
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
