(** Forsyth–Edwards Notation (FEN) encode / decode.

    Optional seventh field is either a layout seed (Anarchy / Chess960) or a
    Queer tag ([dk] / [dq]). *)

type error =
  | Malformed of string
  | Invalid of string

val error_to_string : error -> string

val to_fen : ?seed:int -> Position.t -> string
(** Encode [pos] as FEN. Appends [seed] or a Queer tag as a seventh field when
    applicable. *)

val of_fen : string -> (Position.t * int option, error) result
(** Parse FEN into a position and optional layout seed. *)
