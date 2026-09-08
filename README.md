# Spade3

A local 4-player trick-taking card game with a secret-teammate twist,
played across 4 browser tabs in the same window.

- **Backend:** Python + FastAPI, in-memory game state, REST for lobby actions, WebSockets for live play.
- **Frontend:** React + TypeScript + Vite.

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

The API will be running at `http://localhost:8000`. You can check `http://localhost:8000/api/health`.

### 2. Frontend

In a second terminal:

```
cd frontend
npm install
npm run dev
```

This starts Vite at `http://localhost:5173`.

### 3. Play

1. Open `http://localhost:5173` in Tab 1 → **Create game** → note the 6-character game code.
2. Open 3 more tabs to the same URL → **Join game** with that code in each.
3. Once all 4 are in, Tab 1's "Start game" button appears (any tab can click it) and the hand begins.

Each tab keeps its own player identity in the browser's `sessionStorage`
(not `localStorage`), which is what makes 4 tabs in one window work
correctly without them fighting over the same session.

## Notes / next steps

- Game state lives entirely in the backend's memory — restarting the
  backend clears all games. There's no database in this version.
- All rules (legal cards, bid validation, trick winners, scoring) are
  enforced server-side; the frontend only renders state and sends intents.
- Natural follow-ups if you want to keep building: reconnect handling,
  multiple hands per game with running scores, an AI/bot player for
  fewer than 4 humans, and deploying the backend somewhere reachable
  by phones/other devices instead of just localhost.
