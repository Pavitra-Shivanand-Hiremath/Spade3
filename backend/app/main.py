"""Spade3 FastAPI backend: REST for lobby actions, WebSocket for live play."""
from __future__ import annotations

import asyncio

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional

from .game.cards import Card, Suit
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
    vs_bots: bool = False


class JoinGameRequest(BaseModel):
    name: Optional[str] = None


# ----------------------------------------------------------------------
# REST endpoints
# ----------------------------------------------------------------------
@app.post("/api/games")
def create_game(body: CreateGameRequest):
    game = game_manager.create_game(max_bid=body.max_bid, num_players=body.num_players)
    player = game.add_player(name=body.name)

    if body.vs_bots:
        # Fill every remaining seat with a bot and start immediately - no
        # need to wait in a lobby for anyone else to join.
        while len(game.players) < game.num_players:
            game.add_player(is_bot=True)
        game.start_game()

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
    await run_bots(game)

    try:
        while True:
            message = await websocket.receive_json()
            await handle_message(game, player_id, message)
    except WebSocketDisconnect:
        removed = connection_manager.disconnect(game_id, player_id, websocket)
        if removed:
            # Only announce a disconnect (and only flip connected=False) if
            # this was genuinely the current connection for this player -
            # if it was a stale/old connection superseded by a reconnect,
            # the player is actually still connected via the newer one.
            game.set_connected(player_id, False)
            await connection_manager.broadcast_state(game)
    except RuntimeError as e:
        print(
            f"[WS] Runtime error "
            f"game={game_id} player={player_id}: {e}"
        )

        removed = connection_manager.disconnect(
            game_id,
            player_id,
            websocket,
        )

        if removed:
            game.set_connected(player_id, False)
            await connection_manager.broadcast_state(game)
    


async def run_bots(game) -> None:
    """Play out consecutive bot turns (bidding, team/trump selection, card
    play) until it's a human's turn or the game ends. Each bot action is
    broadcast individually so watchers can actually see it happen, with a
    short pause so it doesn't feel instant/jarring."""
    while True:
        if game.phase == GamePhase.BIDDING:
            pid = game.current_bidder_id()
            player = game.player_by_id(pid) if pid else None
            if not (player and player.is_bot):
                return
            await asyncio.sleep(1)
            game.bot_bidding_action(pid)
            await connection_manager.broadcast_state(game)

        elif game.phase == GamePhase.TEAM_SELECTION:
            player = game.player_by_id(game.bidder_id) if game.bidder_id else None
            if not (player and player.is_bot):
                return
            await asyncio.sleep(1)
            game.bot_team_selection(game.bidder_id)
            await connection_manager.broadcast_state(game)

        elif game.phase == GamePhase.PLAYING and not game.trick_settling:
            cur_id = game.players[game.current_turn_index].id if game.players else None
            player = game.player_by_id(cur_id) if cur_id else None
            if not (player and player.is_bot):
                return
            await asyncio.sleep(1)
            card = game.bot_choose_card(cur_id)
            game.play_card(cur_id, card)
            if game.trick_settling:
                await connection_manager.broadcast_state(game)
                await asyncio.sleep(2)
                game.finalize_trick()
            await connection_manager.broadcast_state(game)

        else:
            return


async def handle_message(game, player_id: str, message: dict) -> None:
    msg_type = message.get("type")

    if msg_type == "ping":
        # Heartbeat only, keeps the connection alive through idle-timeout
        # proxies. No state change, so no need to rebroadcast to everyone.
        return

    try:
        if msg_type == "start_game":
            game.start_game()

        elif msg_type == "place_bid":
            amount = int(message.get("bid", 0))
            game.place_bid(player_id, amount)

        elif msg_type == "pass_bid":
            is_nil = bool(message.get("is_nil", False))
            game.pass_bid(player_id, is_nil=is_nil)

        elif msg_type == "select_teammate_cards":
            picks = [(Card.from_dict(p["card"]), int(p["occurrence"])) for p in message["picks"]]
            trump_suit = Suit(message["trump_suit"])
            game.select_teammate_cards(player_id, picks, trump_suit)

        elif msg_type == "play_card":
            card = Card.from_dict(message["card"])
            game.play_card(player_id, card)
            if game.trick_settling:
                # Show the completed trick (all cards + who won) to every
                # client for a couple seconds before it clears and the
                # turn advances - otherwise the last card played would
                # never actually be visible.
                await connection_manager.broadcast_state(game)
                await asyncio.sleep(2)
                game.finalize_trick()

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
    await run_bots(game)


@app.get("/api/health")
def health():
    return {"status": "ok"}