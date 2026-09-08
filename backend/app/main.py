"""Spade3 FastAPI backend: REST for lobby actions, WebSocket for live play."""
from __future__ import annotations

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional

from .game.cards import Card
from .game.engine import EngineError, GamePhase, MIN_PLAYERS, MAX_PLAYERS
from .game_manager import game_manager
from .websocket_manager import connection_manager

app = FastAPI(title="Spade3 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------------------------------------------------------
# REST models
# ----------------------------------------------------------------------
class CreateGameRequest(BaseModel):
    max_bid: int = Field(default=150, ge=10, le=1000)
    num_players: int = Field(default=4, ge=MIN_PLAYERS, le=MAX_PLAYERS)
    name: Optional[str] = None


class JoinGameRequest(BaseModel):
    name: Optional[str] = None


# ----------------------------------------------------------------------
# REST endpoints
# ----------------------------------------------------------------------
@app.post("/api/games")
def create_game(body: CreateGameRequest):
    game = game_manager.create_game(max_bid=body.max_bid, num_players=body.num_players)
    player = game.add_player(name=body.name)
    return {
        "game_id": game.game_id,
        "player_id": player.id,
        "player_number": player.position + 1,
        "max_bid": game.max_bid,
        "num_players": game.num_players,
    }


@app.post("/api/games/{game_id}/join")
def join_game(game_id: str, body: JoinGameRequest):
    game = game_manager.get(game_id)
    if not game:
        raise HTTPException(404, "Game not found.")
    try:
        player = game.add_player(name=body.name)
    except EngineError as e:
        raise HTTPException(400, str(e))
    return {
        "game_id": game.game_id,
        "player_id": player.id,
        "player_number": player.position + 1,
        "max_bid": game.max_bid,
        "num_players": game.num_players,
    }


@app.get("/api/games/{game_id}")
def get_game(game_id: str, player_id: Optional[str] = None):
    game = game_manager.get(game_id)
    if not game:
        raise HTTPException(404, "Game not found.")
    return game.serialize_for(player_id)


# ----------------------------------------------------------------------
# WebSocket
# ----------------------------------------------------------------------
@app.websocket("/ws/games/{game_id}")
async def game_socket(websocket: WebSocket, game_id: str):
    player_id = websocket.query_params.get("player_id")
    game = game_manager.get(game_id)

    if not game or not player_id or not game.player_by_id(player_id):
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": "Invalid game or player."})
        await websocket.close()
        return

    await connection_manager.connect(game_id, player_id, websocket)
    game.set_connected(player_id, True)
    await connection_manager.broadcast_state(game)

    try:
        while True:
            message = await websocket.receive_json()
            await handle_message(game, player_id, message)
    except WebSocketDisconnect:
        connection_manager.disconnect(game_id, player_id)
        game.set_connected(player_id, False)
        await connection_manager.broadcast_state(game)


async def handle_message(game, player_id: str, message: dict) -> None:
    msg_type = message.get("type")
    try:
        if msg_type == "start_game":
            game.start_game()

        elif msg_type == "place_bid":
            amount = int(message.get("bid", 0))
            is_nil = bool(message.get("is_nil", False))
            game.place_bid(player_id, amount, is_nil=is_nil)

        elif msg_type == "select_teammate_cards":
            cards = [Card.from_dict(c) for c in message["cards"]]
            game.select_teammate_cards(player_id, cards)

        elif msg_type == "play_card":
            card = Card.from_dict(message["card"])
            game.play_card(player_id, card)

        else:
            await connection_manager.send_error(game.game_id, player_id, f"Unknown message type: {msg_type}")
            return

    except EngineError as e:
        await connection_manager.send_error(game.game_id, player_id, str(e))
        return
    except Exception as e:  # pragma: no cover - defensive
        await connection_manager.send_error(game.game_id, player_id, f"Unexpected error: {e}")
        return

    await connection_manager.broadcast_state(game)


@app.get("/api/health")
def health():
    return {"status": "ok"}