# AI Trip Planner — VS Code project

Two independent pieces that talk to each other over HTTP once both are running
on your machine:

```
ai-trip-planner-vscode/
├── frontend/
│   └── index.html        ← the whole app: UI, auth, itinerary logic, everything
├── backend/
│   ├── server.js         ← real Places (OpenStreetMap), weather, email
│   ├── package.json
│   └── .env.example      ← copy to .env and fill in your own values
├── .vscode/
│   ├── extensions.json   ← recommends the Live Server extension
│   └── tasks.json        ← one-click "install" and "start" tasks for the backend
└── .gitignore
```

Unlike the version you may have seen previewed in claude.ai, **this frontend
actually talks to the backend for real** once both are running locally — the
sandboxed browser preview blocks that kind of call, but your own browser on
your own machine does not. When the backend isn't running, the app quietly
falls back to its built-in curated/mock data instead of breaking.

## 1. Open the project

Open the `ai-trip-planner-vscode` folder in VS Code (`File → Open Folder…`).

## 2. Set up and start the backend

In VS Code's terminal (`` Ctrl+` ``, or `Terminal → New Terminal`):

```bash
cd backend
npm install
cp .env.example .env
```

Now open `backend/.env` and edit it:
- Set `APP_USER_AGENT` to something like `AI-Trip-Planner/1.0 (contact: your-real-email@gmail.com)` — OpenStreetMap's Nominatim requires this on every request, or it may silently block you.
- Fill in the `SMTP_*` values if you want the email feature to actually send (a Gmail account + an **App Password**, not your normal password, is the easiest option — Google Account → Security → 2-Step Verification → App passwords).

Then start it:

```bash
npm start
```

You should see: `AI Trip Planner backend running on http://localhost:5175`.
Leave this terminal running — closing it stops the backend.

(Alternative: instead of typing the commands above, use
`Terminal → Run Task… → Backend: npm install`, then again for
`Backend: start` — these are pre-configured in `.vscode/tasks.json`.)

## 3. Open the frontend

You have two options:

**Option A — just open the file (simplest):**
Right-click `frontend/index.html` in VS Code's file explorer → "Reveal in
File Explorer/Finder" → double-click it to open in your browser. This works
fine, but a few browsers restrict local-file pages slightly more than
server-hosted ones.

**Option B — Live Server (recommended, closer to a real deployment):**
Install the "Live Server" extension VS Code should prompt you to install
(it's listed in `.vscode/extensions.json`). Then right-click
`frontend/index.html` → **"Open with Live Server"**. It'll open at something
like `http://127.0.0.1:5500`.

## 4. Confirm it's connected

With the backend running, open the frontend, sign up/sign in, and generate
a trip. Look at the top-right of the header: it should say
**"🟢 Live backend connected"**. Place and hotel photo tiles will then swap
from illustrated gradient tiles to real photos over the next second or two,
for any place that has a photo on Wikidata (most famous landmarks do).

If it instead says **"⚪ Offline mode (built-in data)"**, the frontend
couldn't reach `http://localhost:5175` — check the backend terminal is still
running and didn't error out, and that nothing else is using port 5175.

## What's genuinely live vs. still curated/estimated

- **Real, live:** place search and coordinates (OpenStreetMap/Nominatim),
  nearby points of interest (Overpass), photos (Wikimedia Commons via
  Wikidata), weather (Open-Meteo), and email sending (your own SMTP/Gmail).
- **Curated, not live:** the 25 destinations with hand-written real
  attractions (Goa, Paris, Tokyo, etc.) — accurate as of when they were
  written, but not re-verified against a live source every time.
- **Estimated, not real:** hotel names/prices/ratings everywhere, and
  activities for destinations outside the curated 25 — clearly labeled as
  such in the app itself.

## Extending it further

- Add more curated destinations: open `frontend/index.html`, search for
  `REAL_PLACES`, and add another entry in the same shape.
- Swap the frontend's photo/search calls to also use `/api/places/nearby`
  (Overpass) for genuinely dynamic activity suggestions instead of only the
  curated list — the endpoint already exists in `backend/server.js`.
- Deploy for real: host `backend/` somewhere with a stable URL (Render,
  Railway, a small VPS), host `frontend/index.html` somewhere static
  (Vercel, Netlify, GitHub Pages), and change `BACKEND_URL` near the top of
  the frontend's `<script>` block from `http://localhost:5175` to your
  backend's real URL.
