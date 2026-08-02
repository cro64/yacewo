(** Full chess position: board, turn, castling, en passant. *)

open Piece

type castling_rights = {
  white_king : bool;
  white_queen : bool;
  black_king : bool;
  black_queen : bool;
}

type t = {
  board : Board.t;
  turn : color;
  castling : castling_rights;
  en_passant : square option;
  halfmove : int;
  fullmove : int;
}

val all_castling : castling_rights
(** All castling rights enabled. *)

val no_castling : castling_rights
(** No castling rights. *)

val make :
  ?turn:color ->
  ?castling:castling_rights ->
  ?en_passant:square option ->
  ?halfmove:int ->
  ?fullmove:int ->
  Board.t ->
  t
(** Build a position from a board and optional fields. *)

val classical : t
(** Standard starting position, White to move. *)

val anarchy : seed:int -> t
(** Anarchy starting position for [seed]. *)

val of_pieces :
  ?turn:color ->
  ?castling:castling_rights ->
  ?en_passant:square option ->
  (square * piece) list ->
  t
(** Position from an explicit piece list (tests / custom setups). *)
