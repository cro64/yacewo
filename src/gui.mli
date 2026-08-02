(** Terminal Unicode board rendering. *)

open Piece

val piece_to_string : piece option -> string
(** Unicode glyph for a piece, or empty for a vacant square. *)

val print_board : Board.t -> string
(** Full board diagram as a string. *)
