type square = int * int

type piece_kind = Pawn | Rook | Knight | Bishop | Queen | King

type color = White | Black

type piece = { kind : piece_kind; color : color }

let opposite = function
  | White -> Black
  | Black -> White

let kind_to_char = function
  | Pawn -> '\000'
  | Rook -> 'R'
  | Knight -> 'N'
  | Bishop -> 'B'
  | Queen -> 'Q'
  | King -> 'K'

let char_to_kind = function
  | 'R' -> Some Rook
  | 'N' -> Some Knight
  | 'B' -> Some Bishop
  | 'Q' -> Some Queen
  | 'K' -> Some King
  | _ -> None

let rook_deltas =
  let rec axis dx dy n acc =
    if n > 8 then acc
    else axis dx dy (n + 1) ((dx * n, dy * n) :: acc)
  in
  axis 1 0 1 [] @ axis (-1) 0 1 [] @ axis 0 1 1 [] @ axis 0 (-1) 1 []

let bishop_deltas =
  let rec diag dx dy n acc =
    if n > 8 then acc
    else diag dx dy (n + 1) ((dx * n, dy * n) :: acc)
  in
  diag 1 1 1 [] @ diag 1 (-1) 1 [] @ diag (-1) 1 1 [] @ diag (-1) (-1) 1 []

let knight_deltas =
  [ (1, 2); (2, 1); (2, -1); (1, -2); (-1, 2); (-2, -1); (-2, 1); (-1, -2) ]

let king_deltas =
  [ (0, 1); (1, 0); (1, 1); (-1, 1); (0, -1); (-1, 0); (-1, -1); (1, -1) ]

let deltas = function
  | Pawn -> [ (0, 1); (0, -1) ]
  | Rook -> rook_deltas
  | Knight -> knight_deltas
  | Bishop -> bishop_deltas
  | Queen -> rook_deltas @ bishop_deltas
  | King -> king_deltas
