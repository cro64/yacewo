open Piece

type move =
  | Normal of { from : square; to_ : square; promotion : piece_kind option }
  | Castle of { side : [ `King | `Queen ]; from : square }

let equal_move a b =
  match (a, b) with
  | ( Normal { from = f1; to_ = t1; promotion = p1 },
      Normal { from = f2; to_ = t2; promotion = p2 } ) ->
      f1 = f2 && t1 = t2 && p1 = p2
  | Castle c1, Castle c2 -> c1.side = c2.side && c1.from = c2.from
  | _ -> false

let find_critical board color kind =
  Board.fold
    (fun sq p acc ->
      if p.kind = kind && p.color = color then sq :: acc else acc)
    board []

(** First critical piece of kind [King], if any — thin wrapper for callers that
    still want a single square. *)
let find_king board color =
  match find_critical board color King with
  | sq :: _ -> Some sq
  | [] -> None

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
    | Rook ->
        (dx = 0 || dy = 0)
        && (dx <> 0 || dy <> 0)
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
  let crit = find_critical pos.Position.board color pos.rules.critical in
  List.exists
    (fun sq -> is_square_attacked pos.board sq (opposite color))
    crit

let pawn_start_rank = function
  | White -> 2
  | Black -> 7

let pawn_promo_rank = function
  | White -> 8
  | Black -> 1

let pawn_dir = function
  | White -> 1
  | Black -> -1

let immobile pos sq = List.mem sq pos.Position.immobile

let drop_immobile immobile sqs =
  List.filter (fun s -> not (List.mem s sqs)) immobile

let castle_dest side (fx, rank) =
  match side with
  | `King -> (fx + 2, rank)
  | `Queen -> (fx - 2, rank)

let castle_rook side rank =
  match side with
  | `King -> ((8, rank), fun (fx, _) -> (fx + 1, rank))
  | `Queen -> ((1, rank), fun (fx, _) -> (fx - 1, rank))

let path_empty_between board (fx, rank) rook_file =
  let lo, hi =
    if fx < rook_file then (fx + 1, rook_file - 1) else (rook_file + 1, fx - 1)
  in
  let rec loop f =
    if f > hi then true
    else if Board.get board (f, rank) <> None then false
    else loop (f + 1)
  in
  loop lo

let squares_passed side (fx, rank) =
  match side with
  | `King -> [ (fx, rank); (fx + 1, rank); (fx + 2, rank) ]
  | `Queen -> [ (fx, rank); (fx - 1, rank); (fx - 2, rank) ]

let can_castle_from pos side from =
  let open Position in
  let fx, rank = from in
  let back = if pos.turn = White then 1 else 8 in
  if rank <> back then false
  else
    match Board.get pos.board from with
    | Some p when p.color = pos.turn && p.kind = pos.rules.critical -> (
        let rook_from, _ = castle_rook side rank in
        let dest = castle_dest side from in
        if not (Board.on_board dest) then false
        else
          let rights_ok =
            match pos.rules.castling with
            | Disabled -> false
            | Flexible -> immobile pos from && immobile pos rook_from
            | Standard ->
                let rights =
                  match (side, pos.turn) with
                  | `King, White -> pos.castling.white_king
                  | `King, Black -> pos.castling.black_king
                  | `Queen, White -> pos.castling.white_queen
                  | `Queen, Black -> pos.castling.black_queen
                in
                rights && fx = 5
          in
          let rook_ok =
            Board.get pos.board rook_from
            = Some { kind = Rook; color = pos.turn }
          in
          let path_ok = path_empty_between pos.board from (fst rook_from) in
          let safe =
            List.for_all
              (fun sq ->
                not (is_square_attacked pos.board sq (opposite pos.turn)))
              (squares_passed side from)
          in
          rights_ok && rook_ok && path_ok && safe
          && Board.get pos.board dest = None)
    | _ -> false

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
  if
    dest <> None
    && (match dest with Some p -> p.color = piece.color | None -> false)
  then false
  else if abs dx = 1 && dy = dir then dest <> None || ep_ok
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
  | Castle { side; from } -> can_castle_from pos side from
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
            | true, Some k when List.mem k pos.rules.promo_kinds -> true
            | true, None -> true
            | true, Some _ -> false
            | false, Some _ -> false
            | false, None -> true)

let update_castling castling critical from to_ piece =
  let open Position in
  let strip_white c = { c with white_king = false; white_queen = false } in
  let strip_black c = { c with black_king = false; black_queen = false } in
  let c = castling in
  let c =
    match (piece.kind, piece.color) with
    | k, White when k = critical -> strip_white c
    | k, Black when k = critical -> strip_black c
    | Rook, White when from = (1, 1) -> { c with white_queen = false }
    | Rook, White when from = (8, 1) -> { c with white_king = false }
    | Rook, Black when from = (1, 8) -> { c with black_queen = false }
    | Rook, Black when from = (8, 8) -> { c with black_king = false }
    | _ -> c
  in
  match to_ with
  | 1, 1 -> { c with white_queen = false }
  | 8, 1 -> { c with white_king = false }
  | 1, 8 -> { c with black_queen = false }
  | 8, 8 -> { c with black_king = false }
  | _ -> c

let with_board_meta pos board castling en_passant halfmove =
  {
    pos with
    Position.board;
    castling;
    en_passant;
    halfmove;
    turn = opposite pos.Position.turn;
    fullmove =
      (if pos.turn = Black then pos.fullmove + 1 else pos.fullmove);
  }

let apply_unchecked pos move =
  let open Position in
  match move with
  | Castle { side; from } ->
      let rank = snd from in
      let dest = castle_dest side from in
      let rook_from, rook_to_of = castle_rook side rank in
      let rook_to = rook_to_of from in
      let board =
        pos.board
        |> fun b -> Board.move b from dest
        |> fun b -> Board.move b rook_from rook_to
      in
      let castling =
        if pos.turn = White then
          { pos.castling with white_king = false; white_queen = false }
        else { pos.castling with black_king = false; black_queen = false }
      in
      let immobile = drop_immobile pos.immobile [ from; rook_from ] in
      {
        (with_board_meta pos board castling None (pos.halfmove + 1)) with
        immobile;
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
        if piece.kind = Pawn && abs (snd to_ - snd from) = 2 then
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
      let immobile = drop_immobile pos.immobile [ from ] in
      {
        (with_board_meta pos board
           (update_castling pos.castling pos.rules.critical from to_ piece)
           en_passant halfmove)
        with
        immobile;
      }

let would_leave_in_check pos move =
  let next = apply_unchecked pos move in
  in_check next pos.turn

let is_legal pos move =
  is_pseudo_legal pos move && not (would_leave_in_check pos move)

let promo_variants pos from to_ piece =
  if piece.kind = Pawn && snd to_ = pawn_promo_rank piece.color then
    List.map
      (fun k -> Normal { from; to_; promotion = Some k })
      pos.Position.rules.promo_kinds
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

let castle_candidates pos =
  let open Position in
  let rank = if pos.turn = White then 1 else 8 in
  let origins =
    match pos.rules.castling with
    | Disabled -> []
    | Standard -> [ (5, rank) ]
    | Flexible ->
        find_critical pos.board pos.turn pos.rules.critical
        |> List.filter (fun (_, r) -> r = rank)
  in
  List.concat_map
    (fun from ->
      (if can_castle_from pos `King from then
         [ Castle { side = `King; from } ]
       else [])
      @
      if can_castle_from pos `Queen from then
        [ Castle { side = `Queen; from } ]
      else [])
    origins

let legal_moves pos =
  let piece_moves =
    Board.pieces_of pos.Position.board pos.turn
    |> List.concat_map (fun (from, piece) ->
           targets_for piece from pos
           |> List.filter Board.on_board
           |> List.concat_map (fun to_ -> promo_variants pos from to_ piece)
           |> List.filter (is_legal pos))
  in
  let castles = castle_candidates pos |> List.filter (is_legal pos) in
  piece_moves @ castles
