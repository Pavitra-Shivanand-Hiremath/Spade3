import { useEffect, useRef, useState, useCallback } from "react";
import { GameState, CardT } from "../types/game";
import { gameSocketUrl } from "../services/api";

interface UseGameSocketResult {
  state: GameState | null;
  connected: boolean;
  error: string | null;
  startGame: () => void;
  placeBid: (amount: number) => void;
  passBid: (isNil?: boolean) => void;
  selectTeammateCards: (cards: CardT[], trumpSuit: CardT["suit"]) => void;
  playCard: (card: CardT) => void;
}

// How often to send a heartbeat while idle. Most hosting proxies (Render
// included) silently drop a WebSocket after roughly a minute of no data,
// which is very easy to hit while waiting on someone else's bid or play.
const HEARTBEAT_INTERVAL_MS = 20_000;

// Reconnect backoff: start fast, cap so we don't hammer the server if it's
// genuinely down.
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10_000;

export function useGameSocket(gameId: string | null, playerId: string | null): UseGameSocketResult {
  const [state, setState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  // Distinguishes "we closed this on purpose" (unmount, gameId/playerId
  // change) from an unexpected drop - only the latter should trigger a
  // reconnect attempt.
  const intentionalCloseRef = useRef(false);

  useEffect(() => {
    if (!gameId || !playerId) return;

    intentionalCloseRef.current = false;
    reconnectAttemptsRef.current = 0;

    function clearHeartbeat() {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    }

    function clearReconnectTimer() {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }

    function connect() {
      const ws = new WebSocket(gameSocketUrl(gameId as string, playerId as string));
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttemptsRef.current = 0;

        clearHeartbeat();
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "game_state") {
          setState(msg.state);
          setError(null);
        } else if (msg.type === "error") {
          setError(msg.message);
        }
        // "pong" (if the server ever sends one back) needs no handling -
        // receiving any message at all is proof the connection is alive.
      };

      ws.onclose = () => {
        setConnected(false);
        clearHeartbeat();

        if (intentionalCloseRef.current) return;

        // Unexpected drop - reconnect with capped exponential backoff so a
        // genuinely down server doesn't get hammered with retries.
        const attempt = reconnectAttemptsRef.current;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
        reconnectAttemptsRef.current += 1;

        clearReconnectTimer();
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!intentionalCloseRef.current) connect();
        }, delay);
      };

      ws.onerror = () => {
        // onclose fires right after onerror for WebSockets, so the actual
        // reconnect scheduling happens there - this just avoids an
        // unhandled-error console spam on some browsers.
      };
    }

    connect();

    return () => {
      intentionalCloseRef.current = true;
      clearHeartbeat();
      clearReconnectTimer();
      wsRef.current?.close();
    };
  }, [gameId, playerId]);

  const send = useCallback((payload: object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const startGame = useCallback(() => send({ type: "start_game" }), [send]);

  const placeBid = useCallback((amount: number) => send({ type: "place_bid", bid: amount }), [send]);

  const passBid = useCallback((isNil = false) => send({ type: "pass_bid", is_nil: isNil }), [send]);

  const selectTeammateCards = useCallback(
    (cards: CardT[], trumpSuit: CardT["suit"]) =>
      send({ type: "select_teammate_cards", cards, trump_suit: trumpSuit }),
    [send]
  );

  const playCard = useCallback((card: CardT) => send({ type: "play_card", card }), [send]);

  return { state, connected, error, startGame, placeBid, passBid, selectTeammateCards, playCard };
}