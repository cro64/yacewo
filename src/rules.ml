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

let insufficient_material (pos : Position.t) =
  if pos.rules.horde then false
  else
    let critical = pos.rules.critical in
    let non_critical =
      Board.all_pieces pos.board
      |> List.filter (fun (_, p) -> p.kind <> critical)
    in
    let white =
      List.filter (fun (_, p) -> p.color = White) non_critical
    in
    let black =
      List.filter (fun (_, p) -> p.color = Black) non_critical
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
  (* Horde wipeout: side to move with zero pieces has lost. *)
  if
    pos.Position.rules.horde
    && Board.pieces_of pos.board pos.turn = []
  then Checkmate pos.turn
  else if insufficient_material pos then DrawInsufficient
  else
    let legal = Moves.legal_moves pos in
    let check = Moves.in_check pos pos.turn in
    match (legal, check) with
    | [], true -> Checkmate pos.turn
    | [], false -> Stalemate
    | _, true -> Check pos.turn
    | _, false -> InProgress
