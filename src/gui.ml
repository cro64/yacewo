open Piece

let piece_to_string = function
  | Some { kind = Pawn; color = Black } -> "♟"
  | Some { kind = Rook; color = Black } -> "♜"
  | Some { kind = Knight; color = Black } -> "♞"
  | Some { kind = Bishop; color = Black } -> "♝"
  | Some { kind = Queen; color = Black } -> "♛"
  | Some { kind = King; color = Black } -> "♚"
  | Some { kind = Pawn; color = White } -> "♙"
  | Some { kind = Rook; color = White } -> "♖"
  | Some { kind = Knight; color = White } -> "♘"
  | Some { kind = Bishop; color = White } -> "♗"
  | Some { kind = Queen; color = White } -> "♕"
  | Some { kind = King; color = White } -> "♔"
  | None -> ""

let row_squares rank =
  List.init 8 (fun i -> (i + 1, rank))

let print_rows board pts =
  List.fold_left
    (fun acc sq ->
      let cell =
        match Board.get board sq with
        | None -> "    ║"
        | Some _ as p -> " " ^ piece_to_string p ^ "  ║"
      in
      acc ^ cell)
    "" pts

let row_split_string = "\n    ╠════╬════╬════╬════╬════╬════╬════╬════╣"
let letter = "      a    b    c    d    e    f    g    h"
let top_board_string = "\n    ╔════╦════╦════╦════╦════╦════╦════╦════╗"
let bottom_board_string = "\n    ╚════╩════╩════╩════╩════╩════╩════╩════╝ \n"

let print_row board rank =
  let pts = row_squares rank in
  let body = print_rows board pts in
  match rank with
  | 1 ->
      Printf.sprintf "\n 1  ║%s  1%s%s" body bottom_board_string letter
  | 8 ->
      Printf.sprintf "%s%s\n 8  ║%s  8%s" letter top_board_string body
        row_split_string
  | n ->
      Printf.sprintf "\n %d  ║%s  %d%s" n body n row_split_string

let print_board board =
  let acc = ref "" in
  for i = 1 to 8 do
    acc := print_row board i ^ !acc
  done;
  !acc
