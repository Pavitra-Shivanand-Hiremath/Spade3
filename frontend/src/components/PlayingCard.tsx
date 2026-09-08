import { CardT } from "../types/game";

const SUIT_SYMBOL: Record<string, string> = {
  H: "\u2665",
  D: "\u2666",
  C: "\u2663",
  S: "\u2660",
};

interface Props {
  card: CardT;
  onClick?: () => void;
  disabled?: boolean;
  mini?: boolean;
}

export default function PlayingCard({ card, onClick, disabled, mini }: Props) {
  const isRed = card.suit === "H" || card.suit === "D";
  const symbol = SUIT_SYMBOL[card.suit];
  const classes = [
    "playing-card",
    isRed ? "red" : "black",
    mini ? "mini" : "",
    onClick ? "clickable" : "",
    disabled ? "disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      onClick={disabled ? undefined : onClick}
      role={onClick ? "button" : undefined}
      aria-disabled={disabled}
      title={disabled ? "Not a legal card right now" : undefined}
    >
      <div className="top">
        {card.rank}
        <br />
        {symbol}
      </div>
      <div className="suit-center">{symbol}</div>
      <div className="bottom">
        {card.rank}
        <br />
        {symbol}
      </div>
    </div>
  );
}
