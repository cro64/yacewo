open Piece

let mk kind color = { kind; color }

let classical_side color =
  let back = if color = White then 1 else 8 in
  let pawn_rank = if color = White then 2 else 7 in
  let back_row =
    [
      ((1, back), Rook);
      ((2, back), Knight);
      ((3, back), Bishop);
      ((4, back), Queen);
      ((5, back), King);
      ((6, back), Bishop);
      ((7, back), Knight);
      ((8, back), Rook);
    ]
  in
  let pawns =
    List.init 8 (fun i -> ((i + 1, pawn_rank), Pawn))
  in
  List.map (fun (sq, k) -> (sq, mk k color)) (back_row @ pawns)

let classical =
  classical_side White @ classical_side Black

let random_kind () =
  let r = Random.int 15 in
  if r <= 7 then Pawn
  else if r <= 9 then Rook
  else if r <= 11 then Knight
  else if r <= 13 then Bishop
  else Queen

let anarchy_side color =
  let ranks = if color = White then [ 1; 2 ] else [ 7; 8 ] in
  let squares =
    List.concat_map (fun r -> List.init 8 (fun i -> (i + 1, r))) ranks
  in
  List.map
    (fun sq ->
      let kind =
        if sq = (5, 1) || sq = (5, 8) then King else random_kind ()
      in
      (sq, mk kind color))
    squares

let anarchy ?seed () =
  (match seed with
  | Some s -> Random.init s
  | None -> Random.self_init ());
  anarchy_side White @ anarchy_side Black
