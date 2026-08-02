(** Algebraic notation parsing into moves. *)

open Piece

type error =
  | Empty
  | Malformed
  | Ambiguous
  | Illegal
  | NoMatch

val error_to_string : error -> string

val parse : Position.t -> string -> (Moves.move, error) result
(** Parse algebraic [input] for the side to move in [pos].
    Accepts castling [O-O]/[0-0]/[O-O-O]/[0-0-0], captures with [x],
    and promotions with [=Q] etc. *)

val square_of_string : string -> square option
(** Parse a square like [e4]. *)

val string_of_square : square -> string

val of_move : Position.t -> Moves.move -> string
(** Render [move] in algebraic notation for [pos] (before the move is applied),
    including disambiguation and check / mate markers. *)
