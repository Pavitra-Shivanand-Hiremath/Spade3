"""In-memory registry of active Spade3 games (no database)."""
from __future__ import annotations

import secrets
from typing import Optional

from .game.engine import Game

_GAME_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no ambiguous chars


class GameManager:
    def __init__(self) -> None:
        self.games: dict[str, Game] = {}

    def _new_game_id(self) -> str:
        while True:
            code = "".join(secrets.choice(_GAME_ID_ALPHABET) for _ in range(6))
            if code not in self.games:
                return code

    def create_game(self, max_bid: int = 150, num_players: int = 4) -> Game:
        game_id = self._new_game_id()
        game = Game(game_id=game_id, max_bid=max_bid, num_players=num_players)
        self.games[game_id] = game
        return game

    def get(self, game_id: str) -> Optional[Game]:
        return self.games.get(game_id.upper())


game_manager = GameManager()