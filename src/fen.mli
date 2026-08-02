(** Forsyth–Edwards Notation (FEN) encode / decode.

    Optional seventh field stores an Anarchy RNG seed. *)

type error =
  | Malformed of string
  | Invalid of string

val error_to_string : error -> string

val to_fen : ?seed:int -> Position.t -> string
(** Encode [pos] as FEN. When [seed] is given, append it as a seventh field. *)

val of_fen : string -> (Position.t * int option, error) result
(** Parse FEN into a position and optional Anarchy seed. *)
