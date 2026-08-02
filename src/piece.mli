(** Chess pieces and colors. *)

type square = int * int
(** File and rank on a 1..8 board, e.g. (1,1) = a1, (5,1) = e1. *)

type piece_kind = Pawn | Rook | Knight | Bishop | Queen | King

type color = White | Black

type piece = { kind : piece_kind; color : color }

val opposite : color -> color
(** [opposite c] is the other color. *)

val kind_to_char : piece_kind -> char
(** Algebraic abbreviation: Pawn → '\000' (empty), Knight → 'N', etc. *)

val char_to_kind : char -> piece_kind option
(** Inverse of [kind_to_char] for piece letters (not pawns). *)

val deltas : piece_kind -> (int * int) list
(** Relative move offsets from (0,0) for sliding / leaping pieces (not pawn). *)
