(** Move representation and generation / legality. *)

open Piece

type move =
  | Normal of { from : square; to_ : square; promotion : piece_kind option }
  | Castle of [ `King | `Queen ]

val equal_move : move -> move -> bool

val is_pseudo_legal : Position.t -> move -> bool
(** Geometric / occupancy legality, ignoring check. *)

val would_leave_in_check : Position.t -> move -> bool
(** Whether applying [move] (without validating) leaves the side to move in check. *)

val is_legal : Position.t -> move -> bool
(** Pseudo-legal and does not leave own king in check. *)

val legal_moves : Position.t -> move list
(** All legal moves in [pos]. *)

val apply_unchecked : Position.t -> move -> Position.t
(** Apply a move updating board, turn, castling, en passant, clocks.
    Caller must ensure legality (except castling rights are updated). *)

val find_king : Board.t -> color -> square option

val is_square_attacked : Board.t -> square -> color -> bool
(** [is_square_attacked board sq by_color] — whether [by_color] attacks [sq]. *)

val in_check : Position.t -> color -> bool
