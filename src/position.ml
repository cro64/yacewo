open Piece

type castling_rights = {
  white_king : bool;
  white_queen : bool;
  black_king : bool;
  black_queen : bool;
}

type t = {
  board : Board.t;
  turn : color;
  castling : castling_rights;
  en_passant : square option;
  halfmove : int;
  fullmove : int;
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

let make ?(turn = White) ?(castling = all_castling) ?(en_passant = None)
    ?(halfmove = 0) ?(fullmove = 1) board =
  { board; turn; castling; en_passant; halfmove; fullmove }

let classical = make (Board.of_list Setup.classical)

let anarchy ?seed () = make (Board.of_list (Setup.anarchy ?seed ()))

let of_pieces ?(turn = White) ?(castling = all_castling) ?(en_passant = None)
    pieces =
  make ~turn ~castling ~en_passant (Board.of_list pieces)
