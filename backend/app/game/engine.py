"""Spade3 game engine.

Single authoritative source of truth for one game (one hand, per the
current MVP rules): deal -> bid -> secret teammate selection -> trick
play -> scoring -> game over.

Now supports 4-10 players (previously fixed at 4).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import secrets

from .cards import Card, Suit, card_points, rank_value, build_deck, deal_hands

MIN_PLAYERS = 4
MAX_PLAYERS = 10


class GamePhase(str, Enum):
    WAITING_FOR_PLAYERS = "waiting_for_players"
    BIDDING = "bidding"
    TEAM_SELECTION = "team_selection"
    PLAYING = "playing"
    GAME_OVER = "game_over"


class EngineError(Exception):
    """Raised for illegal actions; caught by the API layer and turned
    into an error message sent back to the offending client."""


@dataclass
class Bid:
    amount: int
    is_nil: bool = False


@dataclass
class Player:
    id: str
    name: str
    position: int
    connected: bool = False
    hand: list[Card] = field(default_factory=list)
    won_cards: list[Card] = field(default_factory=list)


@dataclass
class PlayedCard:
    player_id: str
    card: Card


def teammates_needed_for(num_players: int) -> int:
    """half - 1, integer division. 4p->1, 5p->1, 6p->2, 7p->2, 8p->3, 9p->3, 10p->4."""
    return (num_players // 2) - 1


class Game:
    def __init__(self, game_id: str, max_bid: int = 150, num_players: int = 4):
        if not (MIN_PLAYERS <= num_players <= MAX_PLAYERS):
            raise EngineError(f"num_players must be between {MIN_PLAYERS} and {MAX_PLAYERS}.")

        self.game_id = game_id
        self.max_bid = max_bid
        self.num_players = num_players
        self.teammates_needed = teammates_needed_for(num_players)
        self.phase = GamePhase.WAITING_FOR_PLAYERS

        self.players: list[Player] = []

        # Bidding
        self.bid_order: list[str] = []
        self.bids: dict[str, Bid] = {}
        self.current_bid_index: int = 0
        self.passed_bidders: set[str] = set()
        self.high_bid: Optional[int] = None
        self.high_bidder: Optional[str] = None
        self.bidder_id: Optional[str] = None
        self.bidder_bid: Optional[int] = None

        # Secret teammates (now potentially more than one)
        self.teammate_cards: list[Card] = []
        self.teammate_ids: set[str] = set()
        self.revealed_teammate_ids: set[str] = set()
        self.trump_suit: Optional[Suit] = None

        # Trick play
        self.current_trick: list[PlayedCard] = []
        self.completed_tricks: list[list[PlayedCard]] = []
        self.trick_leader_index: int = 0
        self.current_turn_index: int = 0
        self.trump_broken: bool = False

        # Result
        self.winner_team: Optional[str] = None  # "bidder" | "opponent"
        self.team_points: dict[str, int] = {}
        self.trick_wins: dict[str, int] = {}

        self.last_error: dict[str, str] = {}

    # ------------------------------------------------------------------
    # Lobby
    # ------------------------------------------------------------------
    def add_player(self, name: Optional[str] = None) -> Player:
        if len(self.players) >= self.num_players:
            raise EngineError(f"Game is already full ({self.num_players} players).")
        if self.phase != GamePhase.WAITING_FOR_PLAYERS:
            raise EngineError("Game has already started.")
        position = len(self.players)
        player_id = secrets.token_hex(8)
        player = Player(id=player_id, name=name or f"Player {position + 1}", position=position)
        self.players.append(player)
        return player

    def player_by_id(self, player_id: str) -> Optional[Player]:
        for p in self.players:
            if p.id == player_id:
                return p
        return None

    def set_connected(self, player_id: str, connected: bool) -> None:
        p = self.player_by_id(player_id)
        if p:
            p.connected = connected

    def start_game(self) -> None:
        if len(self.players) != self.num_players:
            raise EngineError(f"Need exactly {self.num_players} players to start.")
        if self.phase != GamePhase.WAITING_FOR_PLAYERS:
            raise EngineError("Game already started.")

        deck = build_deck(self.num_players)
        hands = deal_hands(deck, self.num_players)
        for player, hand in zip(self.players, hands):
            player.hand = hand

        self.bid_order = [p.id for p in self.players]
        self.current_bid_index = 0
        self.bids = {}
        self.passed_bidders = set()
        self.high_bid = None
        self.high_bidder = None
        self.phase = GamePhase.BIDDING

    # ------------------------------------------------------------------
    # Bidding
    # ------------------------------------------------------------------
    BID_INCREMENT = 5

    def current_bidder_id(self) -> Optional[str]:
        if self.phase != GamePhase.BIDDING:
            return None
        return self.bid_order[self.current_bid_index]

    def place_bid(self, player_id: str, amount: int) -> None:
        """Raise the bid. Must be a multiple of BID_INCREMENT and strictly
        higher than the current highest bid (if any)."""
        if self.phase != GamePhase.BIDDING:
            raise EngineError("Not currently in the bidding phase.")
        if self.current_bidder_id() != player_id:
            raise EngineError("It is not your turn to bid.")
        if player_id in self.passed_bidders:
            raise EngineError("You have already passed and can no longer bid.")

        if amount % self.BID_INCREMENT != 0:
            raise EngineError(f"Bid must be a multiple of {self.BID_INCREMENT}.")
        if amount < self.BID_INCREMENT or amount > self.max_bid:
            raise EngineError(f"Bid must be between {self.BID_INCREMENT} and {self.max_bid}.")
        if self.high_bid is not None and amount <= self.high_bid:
            raise EngineError(f"Bid must be higher than the current highest bid ({self.high_bid}).")

        self.bids[player_id] = Bid(amount=amount, is_nil=False)
        self.high_bid = amount
        self.high_bidder = player_id
        self._advance_bid_turn()

    def pass_bid(self, player_id: str, is_nil: bool = False) -> None:
        """Pass (drop out of the auction). Declaring Nil is recorded for
        display but functionally also just passes, since final card points
        (not tricks) decide the hand regardless of who said Nil."""
        if self.phase != GamePhase.BIDDING:
            raise EngineError("Not currently in the bidding phase.")
        if self.current_bidder_id() != player_id:
            raise EngineError("It is not your turn to bid.")
        if player_id in self.passed_bidders:
            raise EngineError("You have already passed.")

        if is_nil:
            self.bids[player_id] = Bid(amount=0, is_nil=True)
        self.passed_bidders.add(player_id)
        self._advance_bid_turn()

    def _advance_bid_turn(self) -> None:
        active = [pid for pid in self.bid_order if pid not in self.passed_bidders]

        if self.high_bidder is not None and len(active) <= 1:
            # Everyone else has passed - auction over, high bidder wins.
            self._resolve_bidding()
            return
        if self.high_bidder is None and len(active) == 0:
            # Everyone passed/nil'd without a single real bid (edge case).
            self._resolve_bidding()
            return

        n = len(self.bid_order)
        idx = self.current_bid_index
        for _ in range(n):
            idx = (idx + 1) % n
            if self.bid_order[idx] not in self.passed_bidders:
                self.current_bid_index = idx
                return
        # Shouldn't be reachable given the checks above, but resolve rather
        # than leave the game stuck if it ever is.
        self._resolve_bidding()

    def _resolve_bidding(self) -> None:
        if self.high_bidder is not None:
            self.bidder_id = self.high_bidder
            self.bidder_bid = self.high_bid
        else:
            # Nobody ever placed a real bid (everyone passed/nil'd) - fall
            # back to the first player at the minimum increment so the game
            # can still proceed rather than getting stuck.
            self.bidder_id = self.bid_order[0]
            self.bidder_bid = self.BID_INCREMENT
        self.phase = GamePhase.TEAM_SELECTION

    # ------------------------------------------------------------------
    # Secret teammate selection (now: pick `teammates_needed` cards)
    # ------------------------------------------------------------------
    def select_teammate_cards(self, player_id: str, cards: list[Card], trump_suit: Suit) -> None:
        if self.phase != GamePhase.TEAM_SELECTION:
            raise EngineError("Not currently in the team selection phase.")
        if player_id != self.bidder_id:
            raise EngineError("Only the bidder selects teammate cards and the trump suit.")
        if len(cards) != self.teammates_needed:
            raise EngineError(f"You must select exactly {self.teammates_needed} card(s).")
        if not isinstance(trump_suit, Suit):
            raise EngineError("Invalid trump suit.")

        # Duplicate face values ARE allowed on purpose: with 2 decks (6-10
        # players), the same card (e.g. A of Spades) exists twice, held by
        # two different players. Selecting it twice lets the bidder target
        # both copies - whoever plays each is independently revealed.

        self.teammate_cards = list(cards)
        self.teammate_ids = set()
        self.revealed_teammate_ids = set()
        self.trump_suit = trump_suit

        # Trick play begins; bidder leads the first trick.
        bidder_index = self.player_by_id(self.bidder_id).position
        self.trick_leader_index = bidder_index
        self.current_turn_index = bidder_index
        self.phase = GamePhase.PLAYING

    def _is_teammate_card(self, card: Card) -> bool:
        return any(tc.suit == card.suit and tc.rank == card.rank for tc in self.teammate_cards)

    # ------------------------------------------------------------------
    # Trick play
    # ------------------------------------------------------------------
    def _led_suit(self) -> Optional[Suit]:
        if not self.current_trick:
            return None
        return self.current_trick[0].card.suit

    def legal_cards(self, player_id: str) -> list[Card]:
        player = self.player_by_id(player_id)
        if not player or self.phase != GamePhase.PLAYING:
            return []
        if self.players[self.current_turn_index].id != player_id:
            return []

        hand = player.hand
        led_suit = self._led_suit()

        if led_suit is None:
            # Leading the trick - spades can be led at any time.
            return list(hand)

        same_suit = [c for c in hand if c.suit == led_suit]
        if same_suit:
            return same_suit
        return list(hand)

    def play_card(self, player_id: str, card: Card) -> None:
        if self.phase != GamePhase.PLAYING:
            raise EngineError("Not currently in the playing phase.")
        player = self.player_by_id(player_id)
        if not player:
            raise EngineError("Unknown player.")
        if self.players[self.current_turn_index].id != player_id:
            raise EngineError("It is not your turn.")

        matching = [c for c in player.hand if c.suit == card.suit and c.rank == card.rank]
        if not matching:
            raise EngineError("You do not hold that card.")
        actual_card = matching[0]

        legal = self.legal_cards(player_id)
        if not any(c.suit == actual_card.suit and c.rank == actual_card.rank for c in legal):
            led_suit = self._led_suit()
            if led_suit is not None and any(c.suit == led_suit for c in player.hand):
                raise EngineError(f"You must follow suit ({led_suit.value}).")
            raise EngineError("You do not have that card available to play.")

        player.hand.remove(actual_card)
        self.current_trick.append(PlayedCard(player_id=player_id, card=actual_card))

        if actual_card.suit == self.trump_suit:
            self.trump_broken = True

        # Reveal a secret teammate the moment their designated card is played.
        # (Bidder is never "revealed" separately - they're always known.)
        if player_id != self.bidder_id and self._is_teammate_card(actual_card) and player_id not in self.revealed_teammate_ids:
            self.teammate_ids.add(player_id)
            self.revealed_teammate_ids.add(player_id)

        if len(self.current_trick) < self.num_players:
            self.current_turn_index = (self.current_turn_index + 1) % self.num_players
            return

        # Trick complete: determine winner.
        winner_played = self._trick_winner(self.current_trick)
        winner = self.player_by_id(winner_played.player_id)
        for pc in self.current_trick:
            winner.won_cards.append(pc.card)
        self.trick_wins[winner.id] = self.trick_wins.get(winner.id, 0) + 1

        self.completed_tricks.append(self.current_trick)
        self.current_trick = []
        self.trick_leader_index = winner.position
        self.current_turn_index = winner.position

        if all(len(p.hand) == 0 for p in self.players):
            self._finish_game()

    def _trick_winner(self, trick: list[PlayedCard]) -> PlayedCard:
        led_suit = trick[0].card.suit
        trump_played = [pc for pc in trick if pc.card.suit == self.trump_suit]
        pool = trump_played if trump_played else [pc for pc in trick if pc.card.suit == led_suit]
        return max(pool, key=lambda pc: rank_value(pc.card.rank))

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------
    def _all_teammates_revealed(self) -> bool:
        return len(self.revealed_teammate_ids) >= self.teammates_needed

    def _finish_game(self) -> None:
        bidder_team_ids = {self.bidder_id} | self.teammate_ids
        opponent_team_ids = {p.id for p in self.players} - bidder_team_ids

        def team_points(ids: set[str]) -> int:
            total = 0
            for p in self.players:
                if p.id in ids:
                    total += sum(card_points(c) for c in p.won_cards)
            return total

        bidder_points = team_points(bidder_team_ids)
        opponent_points = team_points(opponent_team_ids)

        self.team_points = {"bidder": bidder_points, "opponent": opponent_points}
        self.winner_team = "bidder" if bidder_points >= self.bidder_bid else "opponent"
        # Force full reveal at game end regardless of whether every teammate
        # card happened to get played (e.g. it was still in a losing hand).
        self.revealed_teammate_ids = set(self.teammate_ids)
        self.phase = GamePhase.GAME_OVER

    # ------------------------------------------------------------------
    # Serialization (per-player view)
    # ------------------------------------------------------------------
    def serialize_for(self, requesting_player_id: Optional[str]) -> dict:
        bidder_team_ids = None
        if self._all_teammates_revealed() and self.bidder_id:
            bidder_team_ids = {self.bidder_id} | self.revealed_teammate_ids

        players_view = []
        for p in self.players:
            entry = {
                "id": p.id,
                "name": p.name,
                "position": p.position,
                "connected": p.connected,
                "cards_remaining": len(p.hand),
                "tricks_won": self.trick_wins.get(p.id, 0),
                "points": sum(card_points(c) for c in p.won_cards),
                "has_bid": p.id in self.bids,
                "passed": p.id in self.passed_bidders,
            }
            if p.id in self.bids:
                bid = self.bids[p.id]
                entry["bid"] = {"amount": bid.amount, "is_nil": bid.is_nil}
            if bidder_team_ids is not None:
                entry["team"] = "bidder" if p.id in bidder_team_ids else "opponent"
            elif p.id in self.revealed_teammate_ids or p.id == self.bidder_id:
                # Partial reveal: individually-revealed teammates show up
                # as "bidder" team even before every teammate is known.
                if p.id == self.bidder_id or p.id in self.revealed_teammate_ids:
                    entry["team"] = "bidder"
            players_view.append(entry)

        my_hand = []
        legal = []
        player = self.player_by_id(requesting_player_id) if requesting_player_id else None
        if player:
            my_hand = [c.to_dict() for c in sorted(player.hand, key=lambda c: (c.suit.value, rank_value(c.rank)))]
            legal = [c.to_dict() for c in self.legal_cards(requesting_player_id)]

        current_trick = [
            {"player_id": pc.player_id, "card": pc.card.to_dict()} for pc in self.current_trick
        ]

        state = {
            "game_id": self.game_id,
            "phase": self.phase.value,
            "num_players": self.num_players,
            "teammates_needed": self.teammates_needed,
            "max_bid": self.max_bid,
            "players": players_view,
            "my_player_id": requesting_player_id,
            "my_hand": my_hand,
            "legal_cards": legal,
            "current_bidder_id": self.current_bidder_id(),
            "high_bid": self.high_bid,
            "high_bidder_id": self.high_bidder,
            "bidder_id": self.bidder_id,
            "bidder_bid": self.bidder_bid,
            "teammates_revealed_count": len(self.revealed_teammate_ids),
            "all_teammates_revealed": self._all_teammates_revealed(),
            "revealed_teammate_ids": list(self.revealed_teammate_ids),
            "am_i_bidder": requesting_player_id == self.bidder_id,
            "current_trick": current_trick,
            "completed_tricks_count": len(self.completed_tricks),
            "current_turn_id": self.players[self.current_turn_index].id if self.players and self.phase == GamePhase.PLAYING else None,
            "spades_broken": self.trump_broken,
            "trump_suit": self.trump_suit.value if self.trump_suit else None,
            "winner_team": self.winner_team,
            "team_points": self.team_points,
            "teammate_cards": [c.to_dict() for c in self.teammate_cards],
        }
        return state