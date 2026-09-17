"""Tracks live WebSocket connections per game and broadcasts personalized
game state to each connected player."""
from __future__ import annotations

import asyncio

from fastapi import WebSocket

from .game.engine import Game

# If a single send takes longer than this, treat the connection as dead
# rather than let it block/degrade delivery to everyone else.
SEND_TIMEOUT_SECONDS = 5


class ConnectionManager:
    def __init__(self) -> None:
        # game_id -> { player_id -> websocket }
        self.connections: dict[str, dict[str, WebSocket]] = {}

    async def connect(self, game_id: str, player_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.setdefault(game_id, {})[player_id] = websocket

    def disconnect(self, game_id: str, player_id: str, websocket: WebSocket | None = None) -> bool:
        """Remove a connection. If `websocket` is given, only removes it
        when it's still the exact connection on record for that player -
        otherwise a delayed cleanup from an old/stale connection could
        wipe out a newer reconnection registered under the same player_id.
        Returns True if something was actually removed."""
        conns = self.connections.get(game_id)
        if not conns or player_id not in conns:
            return False
        if websocket is not None and conns[player_id] is not websocket:
            # This is a stale cleanup for a connection that's already been
            # superseded by a reconnect - leave the current one alone.
            return False
        del conns[player_id]
        if not conns:
            del self.connections[game_id]
        return True

    async def send_state(self, game: Game, player_id: str) -> None:
        conns = self.connections.get(game.game_id, {})
        ws = conns.get(player_id)
        if ws is None:
            return
        try:
            await asyncio.wait_for(
                ws.send_json({"type": "game_state", "state": game.serialize_for(player_id)}),
                timeout=SEND_TIMEOUT_SECONDS,
            )
        except Exception:
            self.disconnect(game.game_id, player_id, ws)

    async def broadcast_state(self, game: Game) -> None:
        """Send every connected player their personalized state, in
        parallel. A single dead/hung connection (phone locked, backgrounded,
        flaky WiFi - all normal in a real game) must never block or delay
        delivery to everyone else, and must actually be dropped so it
        doesn't keep stalling every future broadcast too."""
        conns = self.connections.get(game.game_id, {})
        if not conns:
            return

        async def _send_one(player_id: str, ws: WebSocket) -> None:
            try:
                await asyncio.wait_for(
                    ws.send_json({"type": "game_state", "state": game.serialize_for(player_id)}),
                    timeout=SEND_TIMEOUT_SECONDS,
                )
            except Exception:
                # Connection is dead or unresponsive - drop it. The client's
                # own reconnect logic will register a fresh connection under
                # this same player_id, which naturally receives a full state
                # broadcast on (re)connect.
                self.disconnect(game.game_id, player_id, ws)

        await asyncio.gather(*(_send_one(pid, ws) for pid, ws in list(conns.items())))

    async def send_error(self, game_id: str, player_id: str, message: str) -> None:
        conns = self.connections.get(game_id, {})
        ws = conns.get(player_id)
        if ws is not None:
            try:
                await asyncio.wait_for(
                    ws.send_json({"type": "error", "message": message}),
                    timeout=SEND_TIMEOUT_SECONDS,
                )
            except Exception:
                self.disconnect(game_id, player_id, ws)


connection_manager = ConnectionManager()