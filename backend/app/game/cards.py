"""Card primitives, deck construction, and scoring for Spade3."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import random


class Suit(str, Enum):
    HEARTS = "H"
    DIAMONDS = "D"
    CLUBS = "C"
    SPADES = "S"


RANK_ORDER = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]

# Fixed cycling order used only when trimming "2" cards to make the deck
# divide evenly across players. Order is arbitrary but must stay fixed
# so trimming is deterministic.
_TWO_TRIM_SUIT_ORDER = [Suit.SPADES, Suit.HEARTS, Suit.CLUBS, Suit.DIAMONDS]


@dataclass(frozen=True)
class Card:
    suit: Suit
    rank: str

    def __str__(self) -> str:  # pragma: no cover - debug helper
        return f"{self.rank}{self.suit.value}"

    def to_dict(self) -> dict:
        return {"suit": self.suit.value, "rank": self.rank}

    @staticmethod
    def from_dict(data: dict) -> "Card":
        return Card(Suit(data["suit"]), data["rank"])


def rank_value(rank: str) -> int:
    return RANK_ORDER.index(rank)


def card_points(card: Card) -> int:
    """Spade3 custom scoring.

    A, K, Q, J, 10 -> 10 points each
    5              -> 5 points
    3 of Spades    -> 30 points
    everything else -> 0 points
    """
    if card.suit == Suit.SPADES and card.rank == "3":
        return 30
    if card.rank == "5":
        return 5
    if card.rank in ("10", "J", "Q", "K", "A"):
        return 10
    return 0


def _single_deck() -> list[Card]:
    return [Card(suit, rank) for suit in Suit for rank in RANK_ORDER]


def decks_needed_for(num_players: int) -> int:
    """4-5 players -> 1 deck (52 cards). 6-10 players -> 2 decks (104 cards)."""
    return 1 if num_players <= 5 else 2


def build_deck(num_players: int) -> list[Card]:
    """Build a shuffled deck sized for `num_players`.

    Uses 1 or 2 standard 52-card decks depending on player count, then
    trims "2" cards (cycling through suits in a fixed order, spanning
    both decks if needed) until the total count divides evenly among
    `num_players`. Finally shuffles the result.
    """
    num_decks = decks_needed_for(num_players)
    deck: list[Card] = []
    for _ in range(num_decks):
        deck.extend(_single_deck())

    remainder = len(deck) % num_players
    if remainder:
        removed = 0
        # Cycle through suits enough times to cover every "2" across both
        # decks (up to num_decks * 4 of them) if it ever came to that.
        suit_cycle = _TWO_TRIM_SUIT_ORDER * num_decks
        for suit in suit_cycle:
            if removed >= remainder:
                break
            for i, c in enumerate(deck):
                if c.suit == suit and c.rank == "2":
                    del deck[i]
                    removed += 1
                    break
        if removed < remainder:
            # Should not happen for 4-10 players (max remainder is well
            # under the number of "2" cards available), but guard anyway.
            raise ValueError(
                f"Could not trim deck evenly for {num_players} players "
                f"(needed to remove {remainder}, only removed {removed})."
            )

    random.shuffle(deck)
    return deck


def deal_hands(deck: list[Card], num_players: int) -> list[list[Card]]:
    """Deal `deck` evenly into `num_players` hands, sorted for display.

    Assumes len(deck) is already divisible by num_players (guaranteed by
    build_deck).
    """
    hands: list[list[Card]] = [[] for _ in range(num_players)]
    for i, card in enumerate(deck):
        hands[i % num_players].append(card)
    for hand in hands:
        hand.sort(key=lambda c: (c.suit.value, rank_value(c.rank)))
    return hands


# ------------------------------------------------------------------
# Legacy aliases (kept in case anything else in the codebase still
# imports the old 4-player-only names).
# ------------------------------------------------------------------
def shuffled_deck() -> list[Card]:
    return build_deck(4)


def deal_four_hands(deck: list[Card]) -> list[list[Card]]:
    return deal_hands(deck, 4)