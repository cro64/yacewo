open Piece

type move =
  | Normal of { from : square; to_ : square; promotion : piece_kind option }
  | Castle of [ `King | `Queen ]

let equal_move a b =
  match (a, b) with
  | ( Normal { from = f1; to_ = t1; promotion = p1 },
      Normal { from = f2; to_ = t2; promotion = p2 } ) ->
      f1 = f2 && t1 = t2 && p1 = p2
  | Castle s1, Castle s2 -> s1 = s2
  | _ -> false

let find_king board color =
  Board.fold
    (fun sq p acc ->
      match acc with
      | Some _ -> acc
      | None -> if p.kind = King && p.color = color then Some sq else None)
    board None

let direction a b = Stdlib.compare b a

let path_clear board (fx, fy) (tx, ty) =
  let dx = direction fx tx in
  let dy = direction fy ty in
  let rec loop x y =
    let nx, ny = (x + dx, y + dy) in
    if (nx, ny) = (tx, ty) then true
    else if Board.get board (nx, ny) <> None then false
    else loop nx ny
  in
  if dx = 0 && dy = 0 then true else loop fx fy

(** Attack generation ignoring whose turn it is — used for check detection. *)
let attacks_square board (fx, fy) piece (tx, ty) =
  if not (Board.on_board (tx, ty)) then false
  else
    let dx, dy = (tx - fx, ty - fy) in
    match piece.kind with
    | Pawn ->
        let dir = if piece.color = White then 1 else -1 in
        dy = dir && abs dx = 1
    | Knight -> List.mem (dx, dy) (deltas Knight)
    | King -> List.mem (dx, dy) (deltas King)
    | Bishop ->
        abs dx = abs dy && dx <> 0 && path_clear board (fx, fy) (tx, ty)
    | Rook -> (dx = 0 || dy = 0) && (dx <> 0 || dy <> 0)
              && path_clear board (fx, fy) (tx, ty)
    | Queen ->
        ((abs dx = abs dy && dx <> 0)
        || ((dx = 0 || dy = 0) && (dx <> 0 || dy <> 0)))
        && path_clear board (fx, fy) (tx, ty)

let is_square_attacked board sq by_color =
  Board.fold
    (fun from p acc ->
      acc || (p.color = by_color && attacks_square board from p sq))
    board false

let in_check pos color =
  match find_king pos.Position.board color with
  | None -> false
  | Some ksq -> is_square_attacked pos.board ksq (opposite color)

let pawn_start_rank = function
  | White -> 2
  | Black -> 7

let pawn_promo_rank = function
  | White -> 8
  | Black -> 1

let pawn_dir = function
  | White -> 1
  | Black -> -1

let can_castle_king_side pos =
  let open Position in
  let rank = if pos.turn = White then 1 else 8 in
  let rights =
    if pos.turn = White then pos.castling.white_king
    else pos.castling.black_king
  in
  rights
  && Board.get pos.board (5, rank) = Some { kind = King; color = pos.turn }
  && Board.get pos.board (8, rank) = Some { kind = Rook; color = pos.turn }
  && Board.get pos.board (6, rank) = None
  && Board.get pos.board (7, rank) = None
  && (not (in_check pos pos.turn))
  && (not (is_square_attacked pos.board (6, rank) (opposite pos.turn)))
  && not (is_square_attacked pos.board (7, rank) (opposite pos.turn))

let can_castle_queen_side pos =
  let open Position in
  let rank = if pos.turn = White then 1 else 8 in
  let rights =
    if pos.turn = White then pos.castling.white_queen
    else pos.castling.black_queen
  in
  rights
  && Board.get pos.board (5, rank) = Some { kind = King; color = pos.turn }
  && Board.get pos.board (1, rank) = Some { kind = Rook; color = pos.turn }
  && Board.get pos.board (2, rank) = None
  && Board.get pos.board (3, rank) = None
  && Board.get pos.board (4, rank) = None
  && (not (in_check pos pos.turn))
  && (not (is_square_attacked pos.board (4, rank) (opposite pos.turn)))
  && not (is_square_attacked pos.board (3, rank) (opposite pos.turn))

let is_pawn_pseudo pos from to_ piece =
  let open Position in
  let fx, fy = from in
  let tx, ty = to_ in
  let dir = pawn_dir piece.color in
  let dx, dy = (tx - fx, ty - fy) in
  let dest = Board.get pos.board to_ in
  let ep_ok =
    match pos.en_passant with
    | Some ep when ep = to_ && abs dx = 1 && dy = dir -> true
    | _ -> false
  in
  if dest <> None && (match dest with Some p -> p.color = piece.color | None -> false)
  then false
  else if abs dx = 1 && dy = dir then
    (* capture or en passant *)
    dest <> None || ep_ok
  else if dx = 0 && dy = dir && dest = None then true
  else if
    dx = 0 && dy = 2 * dir
    && fy = pawn_start_rank piece.color
    && dest = None
    && Board.get pos.board (fx, fy + dir) = None
  then true
  else false

let is_normal_pseudo pos from to_ piece =
  if not (Board.on_board to_) then false
  else if from = to_ then false
  else
    match Board.get pos.Position.board to_ with
    | Some p when p.color = piece.color -> false
    | _ -> (
        let fx, fy = from in
        let tx, ty = to_ in
        let dx, dy = (tx - fx, ty - fy) in
        match piece.kind with
        | Pawn -> is_pawn_pseudo pos from to_ piece
        | Knight -> List.mem (dx, dy) (deltas Knight)
        | King -> List.mem (dx, dy) (deltas King)
        | Bishop ->
            abs dx = abs dy && dx <> 0 && path_clear pos.board from to_
        | Rook ->
            (dx = 0 || dy = 0)
            && (dx <> 0 || dy <> 0)
            && path_clear pos.board from to_
        | Queen ->
            ((abs dx = abs dy && dx <> 0)
            || ((dx = 0 || dy = 0) && (dx <> 0 || dy <> 0)))
            && path_clear pos.board from to_)

let is_pseudo_legal pos move =
  match move with
  | Castle `King -> can_castle_king_side pos
  | Castle `Queen -> can_castle_queen_side pos
  | Normal { from; to_; promotion } -> (
      match Board.get pos.Position.board from with
      | None -> false
      | Some piece ->
          if piece.color <> pos.turn then false
          else if not (is_normal_pseudo pos from to_ piece) then false
          else
            let _, ty = to_ in
            let needs_promo =
              piece.kind = Pawn && ty = pawn_promo_rank piece.color
            in
            match (needs_promo, promotion) with
            | true, Some k when List.mem k [ Queen; Rook; Bishop; Knight ] ->
                true
            | true, None -> true (* default queen allowed at parse time *)
            | true, Some _ -> false
            | false, Some _ -> false
            | false, None -> true)

let update_castling castling from to_ piece =
  let open Position in
  let strip_white_king c = { c with white_king = false; white_queen = false } in
  let strip_black_king c = { c with black_king = false; black_queen = false } in
  let c = castling in
  let c =
    match (piece.kind, piece.color, from) with
    | King, White, _ -> strip_white_king c
    | King, Black, _ -> strip_black_king c
    | Rook, White, (1, 1) -> { c with white_queen = false }
    | Rook, White, (8, 1) -> { c with white_king = false }
    | Rook, Black, (1, 8) -> { c with black_queen = false }
    | Rook, Black, (8, 8) -> { c with black_king = false }
    | _ -> c
  in
  (* captured rook loses rights *)
  match to_ with
  | 1, 1 -> { c with white_queen = false }
  | 8, 1 -> { c with white_king = false }
  | 1, 8 -> { c with black_queen = false }
  | 8, 8 -> { c with black_king = false }
  | _ -> c

let apply_unchecked pos move =
  let open Position in
  match move with
  | Castle side ->
      let rank = if pos.turn = White then 1 else 8 in
      let king_to, rook_from, rook_to =
        match side with
        | `King -> ((7, rank), (8, rank), (6, rank))
        | `Queen -> ((3, rank), (1, rank), (4, rank))
      in
      let board =
        pos.board
        |> fun b -> Board.move b (5, rank) king_to
        |> fun b -> Board.move b rook_from rook_to
      in
      let castling =
        if pos.turn = White then
          { pos.castling with white_king = false; white_queen = false }
        else { pos.castling with black_king = false; black_queen = false }
      in
      {
        board;
        turn = opposite pos.turn;
        castling;
        en_passant = None;
        halfmove = pos.halfmove + 1;
        fullmove =
          (if pos.turn = Black then pos.fullmove + 1 else pos.fullmove);
      }
  | Normal { from; to_; promotion } ->
      let piece =
        match Board.get pos.board from with
        | Some p -> p
        | None -> failwith "apply_unchecked: empty from"
      in
      let is_ep =
        piece.kind = Pawn
        &&
        match pos.en_passant with
        | Some ep when ep = to_ -> Board.get pos.board to_ = None
        | _ -> false
      in
      let board =
        let b =
          if is_ep then
            let cap_sq = (fst to_, snd from) in
            Board.remove pos.board cap_sq
          else pos.board
        in
        let b = Board.move b from to_ in
        match promotion with
        | Some k when piece.kind = Pawn ->
            Board.set b to_ { kind = k; color = piece.color }
        | None when piece.kind = Pawn && snd to_ = pawn_promo_rank piece.color ->
            Board.set b to_ { kind = Queen; color = piece.color }
        | _ -> b
      in
      let en_passant =
        if
          piece.kind = Pawn
          && abs (snd to_ - snd from) = 2
        then
          let mid = (fst from, (snd from + snd to_) / 2) in
          Some mid
        else None
      in
      let captured =
        (not is_ep) && Board.get pos.board to_ <> None || is_ep
      in
      let halfmove =
        if piece.kind = Pawn || captured then 0 else pos.halfmove + 1
      in
      {
        board;
        turn = opposite pos.turn;
        castling = update_castling pos.castling from to_ piece;
        en_passant;
        halfmove;
        fullmove =
          (if pos.turn = Black then pos.fullmove + 1 else pos.fullmove);
      }

let would_leave_in_check pos move =
  let next = apply_unchecked pos move in
  in_check next pos.turn

let is_legal pos move =
  is_pseudo_legal pos move && not (would_leave_in_check pos move)

let promo_variants from to_ piece =
  if piece.kind = Pawn && snd to_ = pawn_promo_rank piece.color then
    List.map
      (fun k -> Normal { from; to_; promotion = Some k })
      [ Queen; Rook; Bishop; Knight ]
  else [ Normal { from; to_; promotion = None } ]

let targets_for piece from _pos =
  let fx, fy = from in
  match piece.kind with
  | Pawn ->
      let dir = pawn_dir piece.color in
      let forwards =
        (fx, fy + dir)
        ::
        (if fy = pawn_start_rank piece.color then [ (fx, fy + (2 * dir)) ]
         else [])
      in
      let captures = [ (fx - 1, fy + dir); (fx + 1, fy + dir) ] in
      forwards @ captures
  | Knight | King ->
      List.map (fun (dx, dy) -> (fx + dx, fy + dy)) (deltas piece.kind)
  | Bishop | Rook | Queen ->
      List.map (fun (dx, dy) -> (fx + dx, fy + dy)) (deltas piece.kind)
      |> List.filter Board.on_board

let legal_moves pos =
  let piece_moves =
    Board.pieces_of pos.Position.board pos.turn
    |> List.concat_map (fun (from, piece) ->
           targets_for piece from pos
           |> List.filter Board.on_board
           |> List.concat_map (fun to_ -> promo_variants from to_ piece)
           |> List.filter (is_legal pos))
  in
  let castles =
    (if can_castle_king_side pos && is_legal pos (Castle `King) then
       [ Castle `King ]
     else [])
    @
    if can_castle_queen_side pos && is_legal pos (Castle `Queen) then
      [ Castle `Queen ]
    else []
  in
  piece_moves @ castles
