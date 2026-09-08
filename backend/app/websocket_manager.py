"""Tracks live WebSocket connections per game and broadcasts personalized
game state to each connected player."""
from __future__ import annotations

from fastapi import WebSocket

from .game.engine import Game


class ConnectionManager:
    def __init__(self) -> None:
        # game_id -> { player_id -> websocket }
        self.connections: dict[str, dict[str, WebSocket]] = {}

    async def connect(self, game_id: str, player_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.setdefault(game_id, {})[player_id] = websocket

    def disconnect(self, game_id: str, player_id: str) -> None:
        conns = self.connections.get(game_id)
        if conns and player_id in conns:
            del conns[player_id]
            if not conns:
                del self.connections[game_id]

    async def send_state(self, game: Game, player_id: str) -> None:
        conns = self.connections.get(game.game_id, {})
        ws = conns.get(player_id)
        if ws is None:
            return
        await ws.send_json({"type": "game_state", "state": game.serialize_for(player_id)})

    async def broadcast_state(self, game: Game) -> None:
        conns = self.connections.get(game.game_id, {})
        for player_id, ws in list(conns.items()):
            try:
                await ws.send_json({"type": "game_state", "state": game.serialize_for(player_id)})
            except Exception:
                pass

    async def send_error(self, game_id: str, player_id: str, message: str) -> None:
        conns = self.connections.get(game_id, {})
        ws = conns.get(player_id)
        if ws is not None:
            try:
                await ws.send_json({"type": "error", "message": message})
            except Exception:
                pass


connection_manager = ConnectionManager()
