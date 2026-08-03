(** UI-ready chess engine facade. *)

open Piece

type mode = [ `Classical | `Anarchy ]

type error =
  | Notation of Notation.error
  | Fen of Fen.error
  | Illegal_move
  | Undo_unavailable
  | Game_over

val error_to_string : error -> string

type t
(** Opaque game state including history and draw offers. *)

val create : ?seed:int -> mode -> t
(** New game. For Anarchy, [seed] selects the layout; if omitted a random seed
    is chosen and stored. Classical ignores [seed]. *)

val seed : t -> int option
(** Anarchy seed when this game has one. *)

val of_fen : string -> (t, error) result
(** Start a game from a FEN string (empty move list). Optional seventh FEN
    field restores the Anarchy seed. *)

val to_fen : t -> string
(** Current position as FEN; includes seed as a seventh field when present. *)

val move_list : t -> string
(** Played moves in numbered algebraic form, e.g. [1. e4 e5 2. Nf3]. *)

val position : t -> Position.t
val board : t -> Board.t
val turn : t -> color
val status : t -> Rules.status
val legal_moves : t -> Moves.move list

val apply_move : t -> Moves.move -> (t, error) result
val apply_notation : t -> string -> (t, error) result

val undo : t -> (t, error) result
(** Undo the last ply (one half-move). *)

val resign : t -> t
val offer_draw : t -> t
(** Offer / accept draw. Agreement ends the game when both sides have offered
    without an intervening move clearing the opponent's offer. *)

val is_over : t -> bool
