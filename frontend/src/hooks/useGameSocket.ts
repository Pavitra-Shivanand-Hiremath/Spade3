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
    let currentSocket: WebSocket | null = null;

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
      if (intentionalCloseRef.current) return;
    
      const ws = new WebSocket(
        gameSocketUrl(gameId as string, playerId as string)
      );
      
      currentSocket = ws;
      wsRef.current = ws;
    
      ws.onopen = () => {
        // Ignore this socket if another connection has already replaced it.
        if (wsRef.current !== ws) {
          ws.close();
          return;
        }
    
        console.log("[WS] Connected");
    
        setConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
    
        clearHeartbeat();
    
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, HEARTBEAT_INTERVAL_MS);
      };
    
      ws.onmessage = (event) => {
        // Ignore messages from an old socket.
        if (wsRef.current !== ws) {
          return;
        }
    
        try {
          const msg = JSON.parse(event.data);
    
          if (msg.type === "game_state") {
            console.log("[WS] Game state received");
    
            setState(msg.state);
            setError(null);
          } else if (msg.type === "error") {
            console.error("[WS] Server error:", msg.message);
            setError(msg.message);
          }
        } catch (e) {
          console.error("[WS] Invalid message:", e);
        }
      };
    
      ws.onclose = (event) => {
        // Don't let an old socket change the state of the current socket.
        if (wsRef.current !== ws) {
          return;
        }
    
        console.log(`[WS] Connection closed - code=${event.code} reason="${event.reason}" wasClean=${event.wasClean}`);
    
        setConnected(false);
        clearHeartbeat();
    
        if (intentionalCloseRef.current) {
          return;
        }
    
        const attempt = reconnectAttemptsRef.current;
    
        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** attempt,
          RECONNECT_MAX_MS
        );
    
        reconnectAttemptsRef.current += 1;
    
        console.log(
          `[WS] Reconnecting in ${delay}ms`
        );
    
        clearReconnectTimer();
    
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!intentionalCloseRef.current) {
            connect();
          }
        }, delay);
      };
    
      ws.onerror = (event) => {
        console.error("[WS] WebSocket error", event);
      };
    }

    connect();

    // Mobile browsers frequently suspend/kill a WebSocket when a tab is
    // backgrounded (screen locked, app-switched) WITHOUT ever firing
    // onclose - the socket just silently dies. It only becomes apparent
    // once the tab is foregrounded again. Force a reconnect check at that
    // moment instead of waiting for a send to fail first.
    function handleVisibleOrOnline() {
      if (document.visibilityState !== "visible") return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        console.log("[WS] Tab foregrounded / back online - reconnecting now");
        reconnectAttemptsRef.current = 0;
        clearReconnectTimer();
        connect();
      }
    }
    document.addEventListener("visibilitychange", handleVisibleOrOnline);
    window.addEventListener("online", handleVisibleOrOnline);

    // The precise browser hook for this: Chrome (and others) proactively
    // closes any open WebSocket the moment a tab becomes eligible for the
    // back-forward cache (bfcache) - e.g. when it's backgrounded by
    // switching tabs. `pageshow` with `event.persisted === true` fires
    // specifically when the page is being restored FROM that frozen
    // state, and is faster/more reliable for this exact case than waiting
    // on the generic visibilitychange fallback above.
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        console.log("[WS] Restored from back-forward cache - reconnecting now");
        reconnectAttemptsRef.current = 0;
        clearReconnectTimer();
        connect();
      }
    }
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibleOrOnline);
      window.removeEventListener("online", handleVisibleOrOnline);

      intentionalCloseRef.current = true;
    
      clearHeartbeat();
      clearReconnectTimer();
    
      // Only close the socket created by this effect.
      if (currentSocket) {
        if (
          currentSocket.readyState === WebSocket.OPEN ||
          currentSocket.readyState === WebSocket.CONNECTING
        ) {
          currentSocket.close(1000, "Component cleanup");
        }
    
        if (wsRef.current === currentSocket) {
          wsRef.current = null;
        }
      }
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