(** UI-ready chess engine facade. *)

open Piece

type queer_variant = [ `TwoKings | `TwoQueens ]

type mode = [ `Classical | `Anarchy | `Chess960 | `Queer of queer_variant ]

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
(** New game. For Anarchy, [seed] is an arbitrary RNG seed. For Chess960, [seed]
    is a FIDE / Scharnagl position ID in [0, 959] (out of range values are taken
    modulo 960); SP-518 is classical. If [seed] is omitted, a random value is
    chosen and stored. Classical and Queer ignore [seed]. *)

val seed : t -> int option
(** Layout seed / Chess960 ID when this game has one. *)

val of_fen : string -> (t, error) result
(** Start a game from a FEN string (empty move list). Optional seventh FEN
    field restores a layout seed or Queer tag ([dk]/[dq]). *)

val to_fen : t -> string
(** Current position as FEN; includes seed or Queer tag as a seventh field when
    present. *)

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

val draw_offers : t -> bool * bool
(** [(white_offered, black_offered)]. A side's offer persists until the other
    side moves (or the game ends by agreement). *)

val is_over : t -> bool
