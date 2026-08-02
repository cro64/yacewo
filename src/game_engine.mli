(** UI-ready chess engine facade. *)

open Piece

type mode = [ `Classical | `Anarchy ]

type error =
  | Notation of Notation.error
  | Illegal_move
  | Undo_unavailable
  | Game_over

val error_to_string : error -> string

type t
(** Opaque game state including history and draw offers. *)

val create : ?seed:int -> mode -> t
(** New game. [seed] only affects Anarchy. *)

val position : t -> Position.t
val board : t -> Board.t
val turn : t -> color
val status : t -> Rules.status
val legal_moves : t -> Moves.move list

val apply_move : t -> Moves.move -> (t, error) result
val apply_notation : t -> string -> (t, error) result

val undo : t -> (t, error) result
(** Undo last full round (both sides), returning to this player's previous turn. *)

val resign : t -> t
val offer_draw : t -> t
(** Offer / accept draw. Agreement ends the game when both sides have offered
    without an intervening move clearing the opponent's offer. *)

val is_over : t -> bool
