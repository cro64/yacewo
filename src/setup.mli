(** Initial Classical, Anarchy, Chess960, and Queer positions.

    Generation is a small constraint + sampling pipeline (see [setup.ml]):
    fixed squares, required bag placement under constraints, then a fill
    policy for leftover squares. Queer modes use fixed classical-derived
    layouts (homonormative-chess). *)

open Piece

val classical : (square * piece) list
(** Standard starting pieces. *)

val anarchy : seed:int -> (square * piece) list
(** Random non-king pieces on the back two ranks; kings fixed on e1/e8.
    Initializes RNG with [seed]. *)

val chess960_id : int -> int
(** Map any int into the FIDE Chess960 ID range [0, 959] (Scharnagl). *)

val chess960 : seed:int -> (square * piece) list
(** Fischer Random from FIDE / Scharnagl position ID ([seed] mod 960).
    SP-518 is classical; black mirrors white; classical pawns. *)

val queer_kings : (square * piece) list
(** Double Kings: [RNBKKBNR] + pawns for both sides. *)

val queer_queens : (square * piece) list
(** Double Queens: [RNBQQBNR] + pawns for both sides (no kings). *)

val horde : (square * piece) list
(** Lichess Horde: 36 white pawns vs a normal black army. *)
