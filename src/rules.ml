open Piece

type status =
  | InProgress
  | Check of color
  | Checkmate of color
  | Stalemate
  | DrawInsufficient
  | DrawAgreement
  | Resigned of color

let piece_color_square = function
  | (x, y), _ -> (x + y) mod 2

let insufficient_material board =
  let non_kings =
    Board.all_pieces board
    |> List.filter (fun (_, p) -> p.kind <> King)
  in
  let white =
    List.filter (fun (_, p) -> p.color = White) non_kings
  in
  let black =
    List.filter (fun (_, p) -> p.color = Black) non_kings
  in
  let only_minor = function
    | [] -> true
    | [ (_, p) ] -> p.kind = Bishop || p.kind = Knight
    | _ -> false
  in
  match (white, black) with
  | [ (sw, pw) ], [ (sb, pb) ]
    when pw.kind = Bishop && pb.kind = Bishop ->
      piece_color_square (sw, pw) = piece_color_square (sb, pb)
  | _ -> only_minor white && only_minor black

let status_of pos =
  if insufficient_material pos.Position.board then DrawInsufficient
  else
    let legal = Moves.legal_moves pos in
    let check = Moves.in_check pos pos.turn in
    match (legal, check) with
    | [], true -> Checkmate pos.turn
    | [], false -> Stalemate
    | _, true -> Check pos.turn
    | _, false -> InProgress
