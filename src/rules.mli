(** Game-end rules and status. *)

open Piece

type status =
  | InProgress
  | Check of color
  | Checkmate of color
      (** Side that is checkmated (lost). *)
  | Stalemate
  | DrawInsufficient
  | DrawAgreement
  | Resigned of color
      (** Side that resigned. *)

val insufficient_material : Board.t -> bool
(** True when neither side can force checkmate. *)

val status_of : Position.t -> status
(** Derive status from the position (ignores resign / draw agreement). *)
