import { useEffect, useRef, useState, useCallback } from "react";
import { GameState, CardT } from "../types/game";
import { gameSocketUrl } from "../services/api";

interface UseGameSocketResult {
  state: GameState | null;
  connected: boolean;
  error: string | null;
  startGame: () => void;
  placeBid: (amount: number, isNil?: boolean) => void;
  selectTeammateCards: (cards: CardT[]) => void;
  playCard: (card: CardT) => void;
}

export function useGameSocket(gameId: string | null, playerId: string | null): UseGameSocketResult {
  const [state, setState] = useState<GameState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!gameId || !playerId) return;

    const ws = new WebSocket(gameSocketUrl(gameId, playerId));
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "game_state") {
        setState(msg.state);
        setError(null);
      } else if (msg.type === "error") {
        setError(msg.message);
      }
    };

    return () => {
      ws.close();
    };
  }, [gameId, playerId]);

  const send = useCallback((payload: object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const startGame = useCallback(() => send({ type: "start_game" }), [send]);

  const placeBid = useCallback(
    (amount: number, isNil = false) =>
      send({ type: "place_bid", bid: amount, is_nil: isNil}),
    [send]
  );

  const selectTeammateCards = useCallback(
    (cards: CardT[]) => send({ type: "select_teammate_cards", cards }),
    [send]
  );

  const playCard = useCallback((card: CardT) => send({ type: "play_card", card }), [send]);

  return { state, connected, error, startGame, placeBid, selectTeammateCards, playCard };
}