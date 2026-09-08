export type GamePhase =
  | "waiting_for_players"
  | "bidding"
  | "team_selection"
  | "playing"
  | "game_over";

export interface CardT {
  suit: "H" | "D" | "C" | "S";
  rank: string;
}

export interface BidInfo {
  amount: number;
  is_nil: boolean;
}

export interface PlayerView {
  id: string;
  name: string;
  position: number;
  connected: boolean;
  cards_remaining: number;
  tricks_won: number;
  has_bid: boolean;
  bid?: BidInfo;
  team?: "bidder" | "opponent";
}

export interface TrickCard {
  player_id: string;
  card: CardT;
}

export interface GameState {
  game_id: string;
  phase: GamePhase;
  num_players: number;
  teammates_needed: number;
  max_bid: number;
  players: PlayerView[];
  my_player_id: string | null;
  my_hand: CardT[];
  legal_cards: CardT[];
  current_bidder_id: string | null;
  bidder_id: string | null;
  bidder_bid: number | null;
  teammates_revealed_count: number;
  all_teammates_revealed: boolean;
  revealed_teammate_ids: string[];
  am_i_bidder: boolean;
  current_trick: TrickCard[];
  completed_tricks_count: number;
  current_turn_id: string | null;
  spades_broken: boolean;
  winner_team: "bidder" | "opponent" | null;
  team_points: Record<string, number>;
  teammate_cards: CardT[];
}