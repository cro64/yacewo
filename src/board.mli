(** Chess board as a map from squares to pieces. *)

open Piece

type t
(** Opaque board. *)

val empty : t
(** Empty board. *)

val on_board : square -> bool
(** [on_board sq] is whether [sq] is within 1..8 × 1..8. *)

val get : t -> square -> piece option
(** Piece at [square], if any. *)

val set : t -> square -> piece -> t
(** Place [piece] at [square], replacing any occupant. *)

val remove : t -> square -> t
(** Clear [square]. *)

val move : t -> square -> square -> t
(** Move the piece at [from] to [to_], removing any captured piece.
    Raises [Not_found] if [from] is empty. *)

val pieces_of : t -> color -> (square * piece) list
(** All pieces of [color] with their squares. *)

val all_pieces : t -> (square * piece) list
(** All occupied squares. *)

val fold : (square -> piece -> 'a -> 'a) -> t -> 'a -> 'a
(** Fold over occupied squares. *)

val of_list : (square * piece) list -> t
(** Build a board from square/piece pairs. *)
