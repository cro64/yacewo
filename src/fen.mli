(** Forsyth–Edwards Notation (FEN) encode / decode.

    Optional trailing fields: layout seed and/or variant tags
    ([dk] / [dq] / [960]). Chess960 midgame castling rights via FEN are
    approximate (no Shredder/X-FEN); see [immobile] rebuild on load. *)

type error =
  | Malformed of string
  | Invalid of string

val error_to_string : error -> string

val to_fen : ?seed:int -> Position.t -> string
(** Encode [pos] as FEN. Appends variant tag and/or [seed] when applicable. *)

val of_fen : string -> (Position.t * int option, error) result
(** Parse FEN into a position and optional layout seed. *)
