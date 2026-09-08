# Spade3

A local 4-player trick-taking card game with a secret-teammate twist,
played across 4 browser tabs in the same window.

- **Backend:** Python + FastAPI, in-memory game state, REST for lobby actions, WebSockets for live play.
- **Frontend:** React + TypeScript + Vite.
- **Live URL:** `https://spade3.pavihiremath03.workers.dev`

## Game rules (v1)

- 4 players join a table using a 6-character game code.
- Every player bids a point target (0 up to the table's max bid, default 150). Highest bid wins; ties go to whoever bid earliest.
- The highest bidder secretly picks one card from the full deck. Whoever holds that card is their hidden teammate — nobody (including the teammate) is told until that exact card is played.
- Standard trick-taking rules: follow suit if you can, spades are trump, you can't lead spades until they've been "broken."
- Card values: A/K/Q/J/10 = 10 pts, 5 = 5 pts, 3♠ = 30 pts, everything else = 0 pts.
- After all 13 tricks, the bidder's team wins if their total card points ≥ their bid. Otherwise the opposing team wins. No negative scoring, no bags.
- One hand = one game. When it ends, start a new game to play again.

## Project layout

```
Spade3/
├── backend/          FastAPI app (Python)
│   ├── app/
│   │   ├── game/      pure game engine (cards, rules, scoring)
│   │   ├── main.py    REST + WebSocket endpoints
│   │   ├── game_manager.py
│   │   └── websocket_manager.py
│   ├── tests/
│   └── requirements.txt
│
└── frontend/         React + Vite + TypeScript app
    ├── src/
    │   ├── components/
    │   ├── hooks/
    │   ├── services/
    │   ├── types/
    │   └── App.tsx
    └── package.json
```

### 1. Backend

```
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API will be running at `http://localhost:8000`. You can check `http://localhost:8000/api/health`.(In Dev)

### 2. Frontend

In a second terminal:

```
cd frontend
npm install
npm run dev
```

This starts Vite at `http://localhost:5173`.(In Dev)

### 3. Deployment

Spade3 is deployed as two separate services:

- **Frontend** (React + Vite) → [Cloudflare Pages/Workers](https://pages.cloudflare.com)
- **Backend** (FastAPI + WebSockets) → [Render](https://render.com)

They're split because the backend keeps game state in memory and needs a
persistent Python process (which Cloudflare Workers doesn't support), while
the frontend is a static build that Cloudflare serves at the edge.

### Backend (Render)

1. Create a new **Web Service** on Render, connected to this repo.
2. Settings:
   - **Root directory:** `backend`
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
3. Add environment variable `PYTHON_VERSION` = `3.11.9` (pins a stable Python
   version — Render's default can be too new for `pydantic-core`'s prebuilt
   wheels).
4. Once live, note the public URL Render gives you, e.g.
   `https://spade3.onrender.com`.

Live backend URL: `https://spade3.onrender.com`

### Frontend (Cloudflare)

1. In the Cloudflare dashboard: **Workers & Pages → Create application → Pages
   → Connect to Git**, and select this repo.
2. Settings:
   - **Path:** `frontend`
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
3. The `frontend/wrangler.jsonc` file in this repo tells Wrangler to serve
   `dist/` as static assets, with SPA fallback routing.
4. Under **Settings → Variables and secrets**, add a build variable:
   - `VITE_API_URL` = `https://spade3.onrender.com` (your Render backend URL)
5. Trigger a deploy (push a commit, or use "Retry deployment").

Live frontend URL: `https://spade3.pavihiremath03.workers.dev`
