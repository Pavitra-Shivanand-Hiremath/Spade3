import { useEffect, useState } from "react";
import { createGame, joinGame } from "./services/api";
import { useGameSocket } from "./hooks/useGameSocket";
import PlayingCard from "./components/PlayingCard";
import { CardT } from "./types/game";

// sessionStorage (NOT localStorage) is deliberate: it is scoped per browser
// tab, so four tabs in the same window each keep their own identity.
const STORAGE_KEY = "spade3_session";

interface StoredSession {
  gameId: string;
  playerId: string;
  playerNumber: number;
}

function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(s: StoredSession) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function clearSession() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [maxBid, setMaxBid] = useState(150);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { state, connected, error, startGame, placeBid, selectTeammateCard, playCard } = useGameSocket(
    session?.gameId ?? null,
    session?.playerId ?? null
  );

  async function handleCreate() {
    setBusy(true);
    setFormError(null);
    try {
      const res = await createGame(maxBid, name || undefined);
      const s = { gameId: res.game_id, playerId: res.player_id, playerNumber: res.player_number };
      saveSession(s);
      setSession(s);
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!joinCode.trim()) {
      setFormError("Enter a game code.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const res = await joinGame(joinCode.trim().toUpperCase(), name || undefined);
      const s = { gameId: res.game_id, playerId: res.player_id, playerNumber: res.player_number };
      saveSession(s);
      setSession(s);
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function handleLeave() {
    clearSession();
    setSession(null);
  }

  if (!session) {
    return (
      <div className="app-shell">
        <Lobby
          name={name}
          setName={setName}
          joinCode={joinCode}
          setJoinCode={setJoinCode}
          maxBid={maxBid}
          setMaxBid={setMaxBid}
          onCreate={handleCreate}
          onJoin={handleJoin}
          busy={busy}
          error={formError}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <GameScreen
        gameId={session.gameId}
        state={state}
        connected={connected}
        error={error}
        startGame={startGame}
        placeBid={placeBid}
        selectTeammateCard={selectTeammateCard}
        playCard={playCard}
        onLeave={handleLeave}
      />
    </div>
  );
}

// ------------------------------------------------------------------
// Lobby
// ------------------------------------------------------------------
function Lobby(props: {
  name: string;
  setName: (v: string) => void;
  joinCode: string;
  setJoinCode: (v: string) => void;
  maxBid: number;
  setMaxBid: (v: number) => void;
  onCreate: () => void;
  onJoin: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { name, setName, joinCode, setJoinCode, maxBid, setMaxBid, onCreate, onJoin, busy, error } = props;

  return (
    <div className="lobby">
      <div className="brand">
        <span className="suit">&#9824;</span>
        <h1>Spade3</h1>
        <p>A local 4-player trick-taking game with a secret teammate twist.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <h2>Start a new table</h2>
        <div className="field">
          <label htmlFor="name1">Your name (optional)</label>
          <input id="name1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Player" />
        </div>
        <div className="field">
          <label htmlFor="maxbid">Maximum bid</label>
          <input
            id="maxbid"
            type="number"
            min={10}
            max={1000}
            value={maxBid}
            onChange={(e) => setMaxBid(Number(e.target.value))}
          />
        </div>
        <button className="btn btn-primary" onClick={onCreate} disabled={busy}>
          Create game
        </button>
      </div>

      <div className="divider-text">then open 3 more tabs to join</div>

      <div className="panel">
        <h2>Join an existing table</h2>
        <div className="field">
          <label htmlFor="name2">Your name (optional)</label>
          <input id="name2" value={name} onChange={(e) => setName(e.target.value)} placeholder="Player" />
        </div>
        <div className="field">
          <label htmlFor="code">Game code</label>
          <input
            id="code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
          />
        </div>
        <button className="btn btn-secondary" onClick={onJoin} disabled={busy}>
          Join game
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Game screen (waiting room, bidding, team selection, play, results)
// ------------------------------------------------------------------
function GameScreen(props: {
  gameId: string;
  state: ReturnType<typeof useGameSocket>["state"];
  connected: boolean;
  error: string | null;
  startGame: () => void;
  placeBid: (amount: number, isNil?: boolean, isBlindNil?: boolean) => void;
  selectTeammateCard: (card: CardT) => void;
  playCard: (card: CardT) => void;
  onLeave: () => void;
}) {
  const { gameId, state, connected, error, startGame, placeBid, selectTeammateCard, playCard, onLeave } = props;

  if (!state) {
    return (
      <div className="waiting-room">
        <p className="muted">{connected ? "Loading game..." : "Connecting..."}</p>
      </div>
    );
  }

  const me = state.players.find((p) => p.id === state.my_player_id) || null;

  if (state.phase === "waiting_for_players") {
    return (
      <WaitingRoom gameId={gameId} state={state} startGame={startGame} onLeave={onLeave} error={error} />
    );
  }

  return (
    <div className="table-wrap">
      <div className="table-header">
        <h1>Spade3 &mdash; Table {gameId}</h1>
        <div className="bid-target">
          Max bid {state.max_bid}
          {state.bidder_bid !== null ? ` \u00b7 Target ${state.bidder_bid}` : ""}
          <button className="btn btn-secondary" style={{ marginLeft: 16, width: "auto", padding: "6px 12px" }} onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <Felt state={state} playCard={playCard} />

      {state.phase === "bidding" && <BiddingPanel state={state} placeBid={placeBid} />}
      {state.phase === "team_selection" && (
        <TeamSelectionPanel state={state} selectTeammateCard={selectTeammateCard} />
      )}
      {state.phase === "game_over" && <ResultPanel state={state} me={me} onLeave={onLeave} />}
    </div>
  );
}

function WaitingRoom({
  gameId,
  state,
  startGame,
  onLeave,
  error,
}: {
  gameId: string;
  state: NonNullable<ReturnType<typeof useGameSocket>["state"]>;
  startGame: () => void;
  onLeave: () => void;
  error: string | null;
}) {
  const seats = [0, 1, 2, 3].map((i) => state.players.find((p) => p.position === i));
  const full = state.players.length === 4;

  return (
    <div className="waiting-room">
      <p className="muted">Share this code with the other 3 tabs</p>
      <div className="game-code">{gameId}</div>

      {error && <div className="error-banner">{error}</div>}

      <ul className="seat-list">
        {seats.map((p, i) => (
          <li key={i}>
            <span className={`seat-dot ${p ? "filled" : ""}`} />
            {p ? p.name : `Waiting for player ${i + 1}...`}
          </li>
        ))}
      </ul>

      {full ? (
        <button className="btn btn-primary" onClick={startGame}>
          Start game
        </button>
      ) : (
        <p className="muted">Waiting for {4 - state.players.length} more player(s)...</p>
      )}

      <div style={{ marginTop: 18 }}>
        <button className="btn btn-secondary" onClick={onLeave}>
          Leave table
        </button>
      </div>
    </div>
  );
}

function seatPlayers(state: NonNullable<ReturnType<typeof useGameSocket>["state"]>) {
  const byPos = [...state.players].sort((a, b) => a.position - b.position);
  const myIndex = byPos.findIndex((p) => p.id === state.my_player_id);
  if (myIndex === -1) return byPos;
  // Rotate so "me" always renders at the bottom seat.
  return [...byPos.slice(myIndex), ...byPos.slice(0, myIndex)];
}

function Felt({
  state,
  playCard,
}: {
  state: NonNullable<ReturnType<typeof useGameSocket>["state"]>;
  playCard: (card: CardT) => void;
}) {
  const ordered = seatPlayers(state); // [me, left, across, right]
  const top = ordered[2];
  const left = ordered[1];
  const right = ordered[3];
  const me = ordered[0];

  const legalKeys = new Set(state.legal_cards.map((c) => `${c.suit}${c.rank}`));
  const myTurn = state.current_turn_id === state.my_player_id;

  const trickByPlayer = new Map(state.current_trick.map((tc) => [tc.player_id, tc.card]));

  function seatLabel(p: typeof me) {
    if (!p) return null;
    const isTurn = state.current_turn_id === p.id;
    const isMe = p.id === state.my_player_id;
    return (
      <div className={`seat-card ${isTurn ? "active-turn" : ""} ${isMe ? "me" : ""}`}>
        <div className="seat-name">
          {p.name}
          {p.id === state.bidder_id && <span title="Bidder">&#9819;</span>}
        </div>
        <div className="seat-meta">
          <span>{p.cards_remaining} cards</span>
          <span>{p.tricks_won} tricks</span>
          {p.has_bid && p.bid && <span>Bid {p.bid.is_nil || p.bid.is_blind_nil ? "Nil" : p.bid.amount}</span>}
        </div>
        {p.team && <div className={`team-tag ${p.team}`}>{p.team === "bidder" ? "Bidder team" : "Opponents"}</div>}
      </div>
    );
  }

  return (
    <div className="felt">
      <div className="seat-row">{top && seatLabel(top)}</div>

      <div className="middle-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="side-seat">{left && seatLabel(left)}</div>

        <div className="trick-area">
          <div className="seat-row" style={{ gap: 40 }}>
            {[left, top, right].map((p, i) =>
              p ? (
                <TrickSlot key={p.id} card={trickByPlayer.get(p.id)} />
              ) : (
                <div className="trick-slot" key={i} />
              )
            )}
            <TrickSlot card={trickByPlayer.get(me?.id ?? "")} />
          </div>
        </div>

        <div className="side-seat">{right && seatLabel(right)}</div>
      </div>

      <div>
        <div className="status-line">
          {state.phase === "playing" &&
            (myTurn ? "Your turn \u2014 play a card" : `Waiting for ${byId(state, state.current_turn_id)}...`)}
        </div>
              {me && (
          <>
            <div className="seat-row" style={{ marginTop: 8, marginBottom: 8 }}>
              {seatLabel(me)}
            </div>
            <div className="hand-row">
              {state.my_hand.map((c) => {
                const key = `${c.suit}${c.rank}`;
                const isLegal = myTurn && state.phase === "playing" && legalKeys.has(key);
                return (
                  <PlayingCard
                    key={key}
                    card={c}
                    disabled={!isLegal}
                    onClick={isLegal ? () => playCard(c) : undefined}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TrickSlot({ card }: { card: CardT | undefined }) {
  return <div className="trick-slot">{card ? <PlayingCard card={card} mini /> : null}</div>;
}

function byId(state: NonNullable<ReturnType<typeof useGameSocket>["state"]>, id: string | null) {
  return state.players.find((p) => p.id === id)?.name ?? "player";
}

function BiddingPanel({
  state,
  placeBid,
}: {
  state: NonNullable<ReturnType<typeof useGameSocket>["state"]>;
  placeBid: (amount: number, isNil?: boolean, isBlindNil?: boolean) => void;
}) {
  const [amount, setAmount] = useState(Math.round(state.max_bid / 2));
  const myTurn = state.current_bidder_id === state.my_player_id;
  const already = state.players.find((p) => p.id === state.my_player_id)?.has_bid;

  return (
    <div className="action-panel">
      <h3>{myTurn ? "Your bid" : `Waiting for ${byId(state, state.current_bidder_id)} to bid...`}</h3>
      {myTurn && !already && (
        <>
          <div className="field">
            <label htmlFor="bidamt">Point target (0 &ndash; {state.max_bid})</label>
            <input
              id="bidamt"
              type="number"
              min={0}
              max={state.max_bid}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <div className="bid-grid">
            <button className="btn btn-primary" style={{ width: "auto" }} onClick={() => placeBid(amount)}>
              Bid {amount}
            </button>
            <button className="btn btn-secondary" style={{ width: "auto" }} onClick={() => placeBid(0, true, false)}>
              Nil
            </button>
            <button className="btn btn-secondary" style={{ width: "auto" }} onClick={() => placeBid(0, false, true)}>
              Blind Nil
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TeamSelectionPanel({
  state,
  selectTeammateCard,
}: {
  state: NonNullable<ReturnType<typeof useGameSocket>["state"]>;
  selectTeammateCard: (card: CardT) => void;
}) {
  const amBidder = state.am_i_bidder;
  const SUITS: CardT["suit"][] = ["S", "H", "C", "D"];
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const fullDeck: CardT[] = SUITS.flatMap((s) => RANKS.map((r) => ({ suit: s, rank: r })));

  if (!amBidder) {
    return (
      <div className="action-panel">
        <h3>{byId(state, state.bidder_id)} won the bidding at {state.bidder_bid} and is secretly choosing a teammate...</h3>
        <p className="muted">The teammate will be revealed the moment that card is played.</p>
      </div>
    );
  }

  return (
    <div className="action-panel">
      <h3>Pick a card. Whoever holds it becomes your secret teammate.</h3>
      <p className="muted">They won't be revealed until they play this exact card.</p>
      <div className="card-choice-grid">
        {fullDeck.map((c) => (
          <PlayingCard key={`${c.suit}${c.rank}`} card={c} mini onClick={() => selectTeammateCard(c)} />
        ))}
      </div>
    </div>
  );
}

function ResultPanel({
  state,
  me,
  onLeave,
}: {
  state: NonNullable<ReturnType<typeof useGameSocket>["state"]>;
  me: ReturnType<typeof useGameSocket>["state"] extends null ? never : any;
  onLeave: () => void;
}) {
  const myTeam = me?.team;
  const iWon = myTeam ? myTeam === state.winner_team : null;
  const bidderName = byId(state, state.bidder_id);

  return (
    <div className="action-panel">
      <div className={`result-banner ${iWon === null ? "" : iWon ? "win" : "lose"}`}>
        <h2>{state.winner_team === "bidder" ? "Bidder's team wins!" : "Defenders win!"}</h2>
        <p className="muted">
          {bidderName} bid {state.bidder_bid} and the bidder's team scored {state.team_points.bidder} points
          (opponents scored {state.team_points.opponent}).
        </p>
      </div>
      <div className="scoreboard">
        <div className="score-box">
          <div className="label">Bidder team</div>
          <div className="value">{state.team_points.bidder}</div>
        </div>
        <div className="score-box">
          <div className="label">Opponents</div>
          <div className="value">{state.team_points.opponent}</div>
        </div>
      </div>
      <button className="btn btn-primary" onClick={onLeave}>
        Start a new game
      </button>
    </div>
  );
}
