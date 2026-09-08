const BASE_URL = (import.meta as any).env?.VITE_API_URL || "http://localhost:8000";
const WS_BASE_URL = BASE_URL.replace(/^http/, "ws");

export interface CreateGameResponse {
  game_id: string;
  player_id: string;
  player_number: number;
  max_bid: number;
  num_players: number;
}

export async function createGame(maxBid: number, numPlayers: number, name?: string): Promise<CreateGameResponse> {
  const res = await fetch(`${BASE_URL}/api/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_bid: maxBid, num_players: numPlayers, name }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Failed to create game");
  return res.json();
}

export async function joinGame(gameId: string, name?: string): Promise<CreateGameResponse> {
  const res = await fetch(`${BASE_URL}/api/games/${gameId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error((await res.json()).detail || "Failed to join game");
  return res.json();
}

export function gameSocketUrl(gameId: string, playerId: string): string {
  return `${WS_BASE_URL}/ws/games/${gameId}?player_id=${playerId}`;
}