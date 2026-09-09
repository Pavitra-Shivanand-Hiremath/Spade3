import { useState, useEffect } from "react";
import { createGame, joinGame } from "./services/api";
import { useGameSocket } from "./hooks/useGameSocket";
import PlayingCard from "./components/PlayingCard";
import { CardT } from "./types/game";

// sessionStorage (NOT localStorage) is deliberate: it is scoped per browser
// tab, so tabs in the same window each keep their own identity.
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
  const [numPlayers, setNumPlayers] = useState(4);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { state, connected, error, startGame, placeBid, passBid, selectTeammateCards, playCard } = useGameSocket(
    session?.gameId ?? null,
    session?.playerId ?? null
  );

  async function handleCreate() {
    setBusy(true);
    setFormError(null);
    try {
      const res = await createGame(maxBid, numPlayers, name || undefined);
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
          numPlayers={numPlayers}
          setNumPlayers={setNumPlayers}
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
        passBid={passBid}
        selectTeammateCards={selectTeammateCards}
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
  numPlayers: number;
  setNumPlayers: (v: number) => void;
  onCreate: () => void;
  onJoin: () => void;
  busy: boolean;
  error: string | null;
}) {
  const {
    name,
    setName,
    joinCode,
    setJoinCode,
    maxBid,
    setMaxBid,
    numPlayers,
    setNumPlayers,
    onCreate,
    onJoin,
    busy,
    error,
  } = props;

  return (
    <div className="lobby">
      <div className="brand">
        <span className="suit">&#9824;</span>
        <h1>Spade3</h1>
        <p>A local 4-10 player trick-taking game with secret teammates.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <h2>Start a new table</h2>
        <div className="field">
          <label htmlFor="name1">Your name</label>
          <input id="name1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Player" />
        </div>
        <div className="field">
          <label htmlFor="numplayers">Number of players (4-10)</label>
          <input
            id="numplayers"
            type="number"
            min={4}
            max={10}
            value={numPlayers}
            onChange={(e) => {
              const v = Math.max(4, Math.min(10, Number(e.target.value) || 4));
              setNumPlayers(v);
            }}
          />
          <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
            Secret teammates: {Math.floor(numPlayers / 2) - 1} (plus the bidder)
          </p>
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

      <div className="divider-text">need {numPlayers - 1} more players to join</div>

      <div className="panel">
        <h2>Join an existing table</h2>
        <div className="field">
          <label htmlFor="name2">Your name</label>
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
  placeBid: (amount: number) => void;
  passBid: (isNil?: boolean) => void;
  selectTeammateCards: (cards: CardT[], trumpSuit: CardT["suit"]) => void;
  playCard: (card: CardT) => void;
  onLeave: () => void;
}) {
  const { gameId, state, connected, error, startGame, placeBid, passBid, selectTeammateCards, playCard, onLeave } = props;

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

      {state.teammate_cards.length > 0 && (
        <div className="teammate-cards-banner">
          <span className="teammate-cards-label">
            Trump suit: <strong>{trumpSuitName(state.trump_suit)}</strong> &nbsp;&middot;&nbsp;
            {byId(state, state.bidder_id)}'s secret teammate card{state.teammate_cards.length === 1 ? "" : "s"}
            &nbsp;&mdash; watch for {state.teammate_cards.length === 1 ? "it" : "these"} being played:
          </span>
          <div className="teammate-cards-row">
            {state.teammate_cards.map((c) => (
              <PlayingCard key={`${c.suit}${c.rank}`} card={c} mini />
            ))}
          </div>
        </div>
      )}

      <Felt state={state} playCard={playCard} />

      {state.phase === "bidding" && <BiddingPanel state={state} placeBid={placeBid} passBid={passBid} />}
      {state.phase === "team_selection" && (
        <TeamSelectionPanel state={state} selectTeammateCards={selectTeammateCards} />
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
  const seats = Array.from({ length: state.num_players }, (_, i) => state.players.find((p) => p.position === i));
  const full = state.players.length === state.num_players;

  return (
    <div className="waiting-room">
      <p className="muted">Share this code with the other {state.num_players - 1} tab(s)</p>
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
        <p className="muted">Waiting for {state.num_players - state.players.length} more player(s)...</p>
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
  // Rotate so "me" is always first; everyone else follows in turn order.
  return [...byPos.slice(myIndex), ...byPos.slice(0, myIndex)];
}

function Felt({
  state,
  playCard,
}: {
  state: NonNullable<ReturnType<typeof useGameSocket>["state"]>;
  playCard: (card: CardT) => void;
}) {
  const ordered = seatPlayers(state); // [me, next, next, ...] around the table
  const me = ordered[0];
  const opponents = ordered.slice(1);

  const legalKeys = new Set(state.legal_cards.map((c) => `${c.suit}${c.rank}`));
  const myTurn = state.current_turn_id === state.my_player_id;

  const trickByPlayer = new Map(state.current_trick.map((tc) => [tc.player_id, tc.card]));

  // Two-step card play: first click lifts/selects a card, a second click on
  // the same (already-lifted) card plays it. Clicking a different card just
  // switches the lift to that one instead. Any turn change clears the lift
  // so a stale selection can't carry over into someone else's turn.
  const [liftedKey, setLiftedKey] = useState<string | null>(null);
  useEffect(() => {
    setLiftedKey(null);
  }, [state.current_turn_id, state.phase]);

  function handleCardClick(c: CardT, key: string) {
    if (liftedKey === key) {
      playCard(c);
      setLiftedKey(null);
    } else {
      setLiftedKey(key);
    }
  }

  function seatLabel(p: (typeof ordered)[number]) {
    if (!p) return null;
    const isTurn = state.current_turn_id === p.id;
    const isMe = p.id === state.my_player_id;
    return (
      <div className={`seat-card ${isTurn ? "active-turn" : ""} ${isMe ? "me" : ""}`} key={p.id}>
        <div className="seat-name">
          {p.name}
          {p.id === state.bidder_id && <span title="Bidder">&#9819;</span>}
        </div>
        <div className="seat-meta">
          <span>{p.cards_remaining} cards</span>
          <span>{p.points} pts</span>
          {p.has_bid && p.bid && <span>Bid {p.bid.is_nil ? "Nil" : p.bid.amount}</span>}
        </div>
        {p.team && <div className={`team-tag ${p.team}`}>{p.team === "bidder" ? "Bidder team" : "Opponents"}</div>}
      </div>
    );
  }

  return (
    <div className="felt">
      {/* Opponent panels wrap across as many rows as needed for any table size */}
      <div className="seat-row" style={{ flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
        {opponents.map((p) => seatLabel(p))}
      </div>

      <div className="trick-area">
        <div className="seat-row" style={{ gap: 20, flexWrap: "wrap", justifyContent: "center" }}>
          {ordered.map((p) => (
            <TrickSlot key={p.id} card={trickByPlayer.get(p.id)} />
          ))}
        </div>
      </div>

      <div>
        <div className="status-line">
          {state.phase === "playing" &&
            (myTurn
              ? liftedKey
                ? "Tap the lifted card again to play it"
                : "Your turn \u2014 tap a card to select it"
              : `Waiting for ${byId(state, state.current_turn_id)}...`)}
        </div>
        {me && (
          <>
            <div className="seat-row" style={{ marginTop: 8, marginBottom: 8, justifyContent: "center" }}>
              {seatLabel(me)}
            </div>
            <div className="hand-row">
              {state.my_hand.map((c) => {
                const key = `${c.suit}${c.rank}`;
                const isLegal = myTurn && state.phase === "playing" && legalKeys.has(key);
                const isLifted = liftedKey === key;
                return (
                  <div
                    key={key}
                    style={{
                      display: "inline-block",
                      transform: isLifted ? "translateY(-18px)" : "translateY(0)",
                      transition: "transform 0.15s ease-out",
                    }}
                  >
                    <PlayingCard
                      card={c}
                      disabled={!isLegal}
                      onClick={isLegal ? () => handleCardClick(c, key) : undefined}
                    />
                  </div>
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

function trumpSuitName(s: CardT["suit"] | null): string {
  const names: Record<CardT["suit"], string> = { S: "Spades \u2660", H: "Hearts \u2665", C: "Clubs \u2663", D: "Diamonds \u2666" };
  return s ? names[s] : "none";
}

function BiddingPanel({
  state,
  placeBid,
  passBid,
}: {
  state: NonNullable<ReturnType<typeof useGameSocket>["state"]>;
  placeBid: (amount: number) => void;
  passBid: (isNil?: boolean) => void;
}) {
  const INCREMENT = 5;
  const floor = (state.high_bid ?? 0) + INCREMENT;
  const [amount, setAmount] = useState(floor);
  const myTurn = state.current_bidder_id === state.my_player_id;
  const iPassed = state.players.find((p) => p.id === state.my_player_id)?.passed;

  // Keep the input's floor in sync as the high bid rises while it's not my turn.
  useEffect(() => {
    setAmount((prev) => Math.max(prev, floor));
  }, [floor]);

  return (
    <div className="action-panel">
      <h3>{myTurn ? "Your bid" : `Waiting for ${byId(state, state.current_bidder_id)} to bid...`}</h3>

      <p className="muted">
        {state.high_bid !== null
          ? `Current high bid: ${state.high_bid} (${byId(state, state.high_bidder_id)})`
          : "No bids yet"}
      </p>

      <div className="seat-row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {state.players.map((p) => (
          <span key={p.id} className="muted" style={{ fontSize: 13 }}>
            {p.name}: {p.passed ? (p.bid?.is_nil ? "Nil" : "Passed") : p.has_bid ? p.bid?.amount : "\u2014"}
          </span>
        ))}
      </div>

      {myTurn && !iPassed && (
        <>
          <div className="field">
            <label htmlFor="bidamt">Raise to (multiples of {INCREMENT}, minimum {floor})</label>
            <input
              id="bidamt"
              type="number"
              step={INCREMENT}
              min={floor}
              max={state.max_bid}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <div className="bid-grid">
            <button
              className="btn btn-primary"
              style={{ width: "auto" }}
              disabled={amount < floor || amount % INCREMENT !== 0 || amount > state.max_bid}
              onClick={() => placeBid(amount)}
            >
              Bid {amount}
            </button>
            <button className="btn btn-secondary" style={{ width: "auto" }} onClick={() => passBid(false)}>
              Pass
            </button>
            <button className="btn btn-secondary" style={{ width: "auto" }} onClick={() => passBid(true)}>
              Nil
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function cardKey(c: CardT) {
  return `${c.suit}${c.rank}`;
}

function TeamSelectionPanel({
  state,
  selectTeammateCards,
}: {
  state: NonNullable<ReturnType<typeof useGameSocket>["state"]>;
  selectTeammateCards: (cards: CardT[], trumpSuit: CardT["suit"]) => void;
}) {
  const amBidder = state.am_i_bidder;
  const needed = state.teammates_needed;
  const SUITS: CardT["suit"][] = ["S", "H", "C", "D"];
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const fullDeck: CardT[] = SUITS.flatMap((s) => RANKS.map((r) => ({ suit: s, rank: r })));

  const [selected, setSelected] = useState<CardT[]>([]);
  const [trumpSuit, setTrumpSuit] = useState<CardT["suit"] | null>(null);

  const SUIT_NAMES: Record<CardT["suit"], string> = { S: "Spades", H: "Hearts", C: "Clubs", D: "Diamonds" };
  const SUIT_SYMBOLS: Record<CardT["suit"], string> = { S: "\u2660", H: "\u2665", C: "\u2663", D: "\u2666" };

  if (!amBidder) {
    return (
      <div className="action-panel">
        <h3>
          {byId(state, state.bidder_id)} won the bidding at {state.bidder_bid} and is secretly choosing a trump
          suit and {needed === 1 ? "a teammate" : `${needed} teammates`}...
        </h3>
        <p className="muted">Each teammate is revealed the moment they play their designated card.</p>
      </div>
    );
  }

  function toggle(c: CardT) {
    const key = cardKey(c);
    const isSelected = selected.some((s) => cardKey(s) === key);
    if (isSelected) {
      setSelected(selected.filter((s) => cardKey(s) !== key));
    } else if (selected.length < needed) {
      setSelected([...selected, c]);
    }
  }

  function confirm() {
    if (selected.length === needed && trumpSuit) {
      selectTeammateCards(selected, trumpSuit);
    }
  }

  return (
    <div className="action-panel">
      <h3>Choose your trump suit.</h3>
      <p className="muted">Whichever suit you pick beats every other suit in every trick, no matter what's led.</p>
      <div className="bid-grid" style={{ marginBottom: 20 }}>
        {(["S", "H", "C", "D"] as CardT["suit"][]).map((s) => (
          <button
            key={s}
            className={trumpSuit === s ? "btn btn-primary" : "btn btn-secondary"}
            style={{ width: "auto" }}
            onClick={() => setTrumpSuit(s)}
          >
            {SUIT_SYMBOLS[s]} {SUIT_NAMES[s]}
          </button>
        ))}
      </div>

      <h3>
        Pick {needed} card{needed === 1 ? "" : "s"}. Whoever holds each one becomes a secret teammate.
      </h3>
      <p className="muted">
        Selected {selected.length} / {needed}. They won't be revealed until each teammate plays their card.
      </p>
      <div className="card-choice-grid">
        {fullDeck.map((c) => {
          const key = cardKey(c);
          const isSelected = selected.some((s) => cardKey(s) === key);
          const disable = !isSelected && selected.length >= needed;
          return (
            <div
              key={key}
              style={{
                border: isSelected ? "3px solid gold" : "3px solid transparent",
                borderRadius: 8,
                opacity: disable ? 0.4 : 1,
                display: "inline-block",
              }}
            >
              <PlayingCard card={c} mini onClick={disable ? undefined : () => toggle(c)} />
            </div>
          );
        })}
      </div>
      <button
        className="btn btn-primary"
        style={{ marginTop: 16, width: "auto" }}
        disabled={selected.length !== needed || !trumpSuit}
        onClick={confirm}
      >
        Confirm trump suit &amp; {selected.length}/{needed} teammate card{needed === 1 ? "" : "s"}
      </button>
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
