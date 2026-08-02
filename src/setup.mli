(** Initial Classical and Anarchy positions. *)

open Piece

val classical : (square * piece) list
(** Standard starting pieces. *)

val anarchy : seed:int -> (square * piece) list
(** Random non-king pieces on the back two ranks; kings fixed on e1/e8.
    Initializes RNG with [seed]. *)
