open Piece

type castling_rights = {
  white_king : bool;
  white_queen : bool;
  black_king : bool;
  black_queen : bool;
}

(** How castling is offered for this ruleset. *)
type castle_style =
  | Standard
      (** Critical piece on the e-file + classical [KQkq] rights. *)
  | Flexible
      (** Any unmoved critical piece may castle (±2); uses [immobile]. *)
  | Chess960
      (** King ends on c/g, rook on d/f; uses [immobile]. *)
  | Disabled
      (** No castling. *)

(** Mode-independent royal / castling / promotion policy. *)
type ruleset = {
  critical : piece_kind;
  castling : castle_style;
  promo_kinds : piece_kind list;
}

type t = {
  board : Board.t;
  turn : color;
  castling : castling_rights;
  en_passant : square option;
  halfmove : int;
  fullmove : int;
  rules : ruleset;
  immobile : square list;
      (** Squares whose original occupant has not yet moved (Flexible /
          Chess960 castling). *)
}

let all_castling =
  {
    white_king = true;
    white_queen = true;
    black_king = true;
    black_queen = true;
  }

let no_castling =
  {
    white_king = false;
    white_queen = false;
    black_king = false;
    black_queen = false;
  }

let default_promo = [ Queen; Rook; Bishop; Knight ]

let queer_promo = [ Queen; Rook; Bishop; Knight; King ]

let rules_classical =
  { critical = King; castling = Standard; promo_kinds = default_promo }

let rules_anarchy = rules_classical

let rules_chess960 =
  { critical = King; castling = Chess960; promo_kinds = default_promo }

let rules_double_kings =
  { critical = King; castling = Flexible; promo_kinds = queer_promo }

let rules_double_queens =
  { critical = Queen; castling = Flexible; promo_kinds = queer_promo }

let make ?(turn = White) ?(castling = all_castling) ?(en_passant = None)
    ?(halfmove = 0) ?(fullmove = 1) ?(rules = rules_classical)
    ?(immobile = []) board =
  {
    board;
    turn;
    castling;
    en_passant;
    halfmove;
    fullmove;
    rules;
    immobile;
  }

let classical = make ~rules:rules_classical (Board.of_list Setup.classical)

let anarchy ~seed =
  make ~rules:rules_anarchy (Board.of_list (Setup.anarchy ~seed))

let start_immobile pieces = List.map fst pieces

let chess960 ~seed =
  let pieces = Setup.chess960 ~seed in
  (* Immobile is the rights source; KQkq left empty so FEN does not claim
     classical a/h rook rights (full Shredder-FEN deferred). *)
  make ~castling:no_castling ~rules:rules_chess960
    ~immobile:(start_immobile pieces) (Board.of_list pieces)

let queer_kings =
  let pieces = Setup.queer_kings in
  make ~rules:rules_double_kings ~immobile:(start_immobile pieces)
    (Board.of_list pieces)

let queer_queens =
  let pieces = Setup.queer_queens in
  make ~rules:rules_double_queens ~immobile:(start_immobile pieces)
    (Board.of_list pieces)

let of_pieces ?(turn = White) ?(castling = all_castling) ?(en_passant = None)
    ?(rules = rules_classical) ?(immobile = []) pieces =
  make ~turn ~castling ~en_passant ~rules ~immobile (Board.of_list pieces)
