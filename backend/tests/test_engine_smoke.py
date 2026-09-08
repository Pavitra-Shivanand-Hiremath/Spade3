"""Quick smoke test that plays a full random hand end-to-end."""
import random
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.game.engine import Game, GamePhase  # noqa: E402
from app.game.cards import card_points  # noqa: E402


def test_full_hand():
    game = Game(game_id="TEST01", max_bid=150)
    for i in range(4):
        game.add_player(name=f"Player {i+1}")

    game.start_game()
    assert game.phase == GamePhase.BIDDING
    assert sum(len(p.hand) for p in game.players) == 52

    for pid in game.bid_order:
        game.place_bid(pid, amount=random.randint(0, 150))
    assert game.phase == GamePhase.TEAM_SELECTION
    assert game.bidder_id is not None

    bidder = game.player_by_id(game.bidder_id)
    other_hand_card = None
    for p in game.players:
        if p.id != bidder.id:
            other_hand_card = p.hand[0]
            break
    game.select_teammate_card(bidder.id, other_hand_card)
    assert game.phase == GamePhase.PLAYING

    guard = 0
    while game.phase == GamePhase.PLAYING:
        guard += 1
        assert guard < 1000, "infinite loop"
        current_player = game.players[game.current_turn_index]
        legal = game.legal_cards(current_player.id)
        assert legal, "current player must have a legal card"
        game.play_card(current_player.id, legal[0])

    assert game.phase == GamePhase.GAME_OVER
    assert game.winner_team in ("bidder", "opponent")
    total_points = sum(sum(card_points(c) for c in p.won_cards) for p in game.players)
    assert total_points == sum(game.team_points.values())
    print("Smoke test passed. Winner:", game.winner_team, game.team_points)


if __name__ == "__main__":
    test_full_hand()
