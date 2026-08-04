(** Full chess position: board, clocks, and a shared ruleset. *)

open Piece

type castling_rights = {
  white_king : bool;
  white_queen : bool;
  black_king : bool;
  black_queen : bool;
}

type castle_style =
  | Standard
  | Flexible
  | Chess960
  | Disabled

type ruleset = {
  critical : piece_kind;
      (** Kind that must stay safe; check/mate use every piece of this kind. *)
  castling : castle_style;
  promo_kinds : piece_kind list;
  horde : bool;
      (** Lichess Horde: wipeout wins, white rank-1 double-step (no e.p.). *)
}

type t = {
  board : Board.t;
  turn : color;
  castling : castling_rights;
  en_passant : square option;
  halfmove : int;
  fullmove : int;
  rules : ruleset;
  immobile : square list;
}

val all_castling : castling_rights
(** All castling rights enabled. *)

val no_castling : castling_rights
(** No castling rights. *)

val black_castling_only : castling_rights
(** Black kingside and queenside only (Horde). *)

val default_promo : piece_kind list
val queer_promo : piece_kind list

val rules_classical : ruleset
(** Critical king, standard e-file castling, normal promotions. *)

val rules_anarchy : ruleset
(** Same ruleset as classical (layout differs, not royalty). *)

val rules_chess960 : ruleset
(** Critical king, Chess960 castling (c/g and d/f ends), normal promotions. *)

val rules_double_kings : ruleset
(** Critical kings, flexible castling, king-capable promotion. *)

val rules_double_queens : ruleset
(** Critical queens, flexible castling, king-capable promotion. *)

val rules_horde : ruleset
(** Critical king (Black only has one), no white castling rights in practice,
    standard promotions; Horde double-step / wipeout flags. *)

val make :
  ?turn:color ->
  ?castling:castling_rights ->
  ?en_passant:square option ->
  ?halfmove:int ->
  ?fullmove:int ->
  ?rules:ruleset ->
  ?immobile:square list ->
  Board.t ->
  t
(** Build a position from a board and optional fields. *)

val classical : t
(** Standard starting position, White to move. *)

val anarchy : seed:int -> t
(** Anarchy starting position for [seed]. *)

val chess960 : seed:int -> t
(** Chess960 starting position for FIDE ID [seed] (mod 960). *)

val queer_kings : t
(** Double Kings: RNBKKBNR, both kings are critical. *)

val queer_queens : t
(** Double Queens: RNBQQBNR, both queens are critical (no kings). *)

val horde : t
(** Lichess Horde: 36 white pawns vs a normal black army. *)

val of_pieces :
  ?turn:color ->
  ?castling:castling_rights ->
  ?en_passant:square option ->
  ?rules:ruleset ->
  ?immobile:square list ->
  (square * piece) list ->
  t
(** Position from an explicit piece list (tests / custom setups). *)
