(** Move representation and generation / legality. *)

open Piece

type move =
  | Normal of { from : square; to_ : square; promotion : piece_kind option }
  | Castle of { side : [ `King | `Queen ]; from : square }

val equal_move : move -> move -> bool

val is_pseudo_legal : Position.t -> move -> bool
(** Geometric / occupancy legality, ignoring check. *)

val would_leave_in_check : Position.t -> move -> bool
(** Whether applying [move] leaves any of the side-to-move's critical pieces
    in check. *)

val is_legal : Position.t -> move -> bool
(** Pseudo-legal and does not leave own critical piece(s) in check. *)

val legal_moves : Position.t -> move list
(** All legal moves in [pos]. *)

val apply_unchecked : Position.t -> move -> Position.t
(** Apply a move updating board, turn, castling, en passant, clocks.
    Caller must ensure legality (except castling rights are updated). *)

val find_king : Board.t -> color -> square option
(** First king of [color], if any. Prefer [find_critical] for rules work. *)

val find_critical : Board.t -> color -> piece_kind -> square list
(** All squares occupied by [color]'s pieces of [kind]. *)

val is_square_attacked : Board.t -> square -> color -> bool
(** [is_square_attacked board sq by_color] — whether [by_color] attacks [sq]. *)

val in_check : Position.t -> color -> bool
(** True if any piece of [pos.rules.critical] for [color] is attacked. *)

val can_castle_from :
  Position.t -> [ `King | `Queen ] -> square -> bool
(** Whether the critical piece on [from] may castle to [side], per
    [pos.rules.castling]. *)
