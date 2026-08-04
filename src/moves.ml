open Piece

type move =
  | Normal of { from : square; to_ : square; promotion : piece_kind option }
  | Castle of { side : [ `King | `Queen ]; from : square }

(** Resolved castling geometry: g-side (`` `King ``) ends king on g / rook on f;
    c-side (`` `Queen ``) ends king on c / rook on d (Standard & Chess960), or
    ±2 / ±1 from [king_from] (Flexible). *)
type castle_spec = {
  side : [ `King | `Queen ];
  king_from : square;
  king_to : square;
  rook_from : square;
  rook_to : square;
}

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

(** Ranks from which a pawn may double-step (Horde: white also from rank 1). *)
let pawn_double_ranks pos color =
  let base = pawn_start_rank color in
  if pos.Position.rules.horde && color = White then [ 1; base ] else [ base ]

let immobile pos sq = List.mem sq pos.Position.immobile

let drop_immobile immobile sqs =
  List.filter (fun s -> not (List.mem s sqs)) immobile

(* ----- castling: resolve / validate / apply ----- *)

let back_rank = function
  | White -> 1
  | Black -> 8

(** Files between [a] and [b] inclusive, sorted. *)
let files_between fa fb =
  let lo, hi = if fa <= fb then (fa, fb) else (fb, fa) in
  List.init (hi - lo + 1) (fun i -> lo + i)

(** Squares on the king travel path (from → to inclusive). *)
let king_path_squares (fx, rank) (tx, _) =
  List.map (fun f -> (f, rank)) (files_between fx tx)

(** Vacancy along travel from→to, allowing [exempt] occupants (king & rook). *)
let travel_vacant board (fx, rank) (tx, _) exempt =
  let ok f =
    let sq = (f, rank) in
    match Board.get board sq with
    | None -> true
    | Some _ -> List.mem sq exempt
  in
  List.for_all ok (files_between fx tx)

let classic_ends side rank =
  match side with
  | `King -> ((7, rank), (6, rank), (8, rank)) (* king_to, rook_to, default rook_from *)
  | `Queen -> ((3, rank), (4, rank), (1, rank))

let find_rook_on_side board color king_file side rank =
  let pred =
    match side with
    | `King -> fun f -> f > king_file
    | `Queen -> fun f -> f < king_file
  in
  Board.fold
    (fun (f, r) p acc ->
      match acc with
      | Some _ -> acc
      | None ->
          if
            r = rank && p.color = color && p.kind = Rook && pred f
          then Some (f, r)
          else None)
    board None

(** Prefer e-file critical, else lowest file — for notation O-O disambiguation. *)
let sort_origins origins =
  List.sort
    (fun (f1, _) (f2, _) ->
      if f1 = 5 then -1
      else if f2 = 5 then 1
      else compare f1 f2)
    origins

let resolve_spec pos side king_from =
  let open Position in
  let fx, rank = king_from in
  match pos.rules.castling with
  | Disabled -> None
  | Standard ->
      if fx <> 5 then None
      else
        let king_to, rook_to, rook_from = classic_ends side rank in
        Some
          {
            side;
            king_from;
            king_to;
            rook_from;
            rook_to;
          }
  | Flexible ->
      let king_to, rook_to, rook_from =
        match side with
        | `King -> ((fx + 2, rank), (fx + 1, rank), (8, rank))
        | `Queen -> ((fx - 2, rank), (fx - 1, rank), (1, rank))
      in
      if not (Board.on_board king_to && Board.on_board rook_to) then None
      else
        Some
          {
            side;
            king_from;
            king_to;
            rook_from;
            rook_to;
          }
  | Chess960 -> (
      match find_rook_on_side pos.board pos.turn fx side rank with
      | None -> None
      | Some rook_from ->
          let king_to, rook_to, _ = classic_ends side rank in
          Some
            {
              side;
              king_from;
              king_to;
              rook_from;
              rook_to;
            })

let rights_ok pos (spec : castle_spec) =
  let open Position in
  match pos.rules.castling with
  | Disabled -> false
  | Flexible | Chess960 ->
      immobile pos spec.king_from && immobile pos spec.rook_from
  | Standard ->
      let rights =
        match (spec.side, pos.turn) with
        | `King, White -> pos.castling.white_king
        | `King, Black -> pos.castling.black_king
        | `Queen, White -> pos.castling.white_queen
        | `Queen, Black -> pos.castling.black_queen
      in
      rights

let castle_legal pos (spec : castle_spec) =
  let open Position in
  let rank = back_rank pos.turn in
  if snd spec.king_from <> rank || snd spec.rook_from <> rank then false
  else
    match
      ( Board.get pos.board spec.king_from,
        Board.get pos.board spec.rook_from )
    with
    | Some k, Some r
      when k.color = pos.turn
           && k.kind = pos.rules.critical
           && r.color = pos.turn
           && r.kind = Rook ->
        if not (rights_ok pos spec) then false
        else
          let exempt = [ spec.king_from; spec.rook_from ] in
          let path_ok =
            travel_vacant pos.board spec.king_from spec.king_to exempt
            && travel_vacant pos.board spec.rook_from spec.rook_to exempt
          in
          let king_safe =
            (not (in_check pos pos.turn))
            && List.for_all
                 (fun sq ->
                   not
                     (is_square_attacked pos.board sq (opposite pos.turn)))
                 (king_path_squares spec.king_from spec.king_to)
          in
          path_ok && king_safe
    | _ -> false

let castle_specs pos =
  let open Position in
  let rank = back_rank pos.turn in
  let origins =
    match pos.rules.castling with
    | Disabled -> []
    | Standard -> [ (5, rank) ]
    | Flexible | Chess960 ->
        find_critical pos.board pos.turn pos.rules.critical
        |> List.filter (fun (_, r) -> r = rank)
        |> sort_origins
  in
  List.concat_map
    (fun from ->
      List.filter_map
        (fun side ->
          match resolve_spec pos side from with
          | Some spec when castle_legal pos spec -> Some spec
          | _ -> None)
        [ `King; `Queen ])
    origins

let find_castle_spec pos side from =
  List.find_opt
    (fun (s : castle_spec) -> s.side = side && s.king_from = from)
    (castle_specs pos)

let can_castle_from pos side from =
  match find_castle_spec pos side from with
  | Some _ -> true
  | None -> false

let apply_castle_board board (spec : castle_spec) king_piece rook_piece =
  let b = Board.remove board spec.king_from in
  let b =
    if spec.rook_from <> spec.king_from then Board.remove b spec.rook_from
    else b
  in
  let b = Board.set b spec.king_to king_piece in
  Board.set b spec.rook_to rook_piece

(* ----- normal moves ----- *)

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
    && List.mem fy (pawn_double_ranks pos piece.color)
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
  | Castle { side; from } -> (
      match find_castle_spec pos side from with
      | None ->
          (* Caller should only apply legal castles; fall back no-op meta. *)
          failwith "apply_unchecked: illegal castle"
      | Some spec ->
          let king_piece =
            match Board.get pos.board spec.king_from with
            | Some p -> p
            | None -> failwith "apply_unchecked: empty king_from"
          in
          let rook_piece =
            match Board.get pos.board spec.rook_from with
            | Some p -> p
            | None -> failwith "apply_unchecked: empty rook_from"
          in
          let board =
            apply_castle_board pos.board spec king_piece rook_piece
          in
          let castling =
            if pos.turn = White then
              { pos.castling with white_king = false; white_queen = false }
            else { pos.castling with black_king = false; black_queen = false }
          in
          let immobile =
            drop_immobile pos.immobile [ spec.king_from; spec.rook_from ]
          in
          {
            (with_board_meta pos board castling None (pos.halfmove + 1)) with
            immobile;
          })
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
      let captured_sq =
        if is_ep then Some (fst to_, snd from)
        else if Board.get pos.board to_ <> None then Some to_
        else None
      in
      let board =
        let b =
          match captured_sq with
          | Some cap when is_ep -> Board.remove pos.board cap
          | _ -> pos.board
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
        (* Horde: double-step from rank 1 does not grant en passant (Lichess). *)
        if piece.kind = Pawn && abs (snd to_ - snd from) = 2 then
          let from_rank = snd from in
          let horde_no_ep =
            pos.rules.horde && piece.color = White && from_rank = 1
          in
          if horde_no_ep then None
          else
            let mid = (fst from, (snd from + snd to_) / 2) in
            Some mid
        else None
      in
      let captured = captured_sq <> None in
      let halfmove =
        if piece.kind = Pawn || captured then 0 else pos.halfmove + 1
      in
      let drop =
        from
        :: (match captured_sq with Some sq -> [ sq ] | None -> [])
      in
      let immobile = drop_immobile pos.immobile drop in
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

let targets_for piece from pos =
  let fx, fy = from in
  match piece.kind with
  | Pawn ->
      let dir = pawn_dir piece.color in
      let forwards =
        (fx, fy + dir)
        ::
        (if List.mem fy (pawn_double_ranks pos piece.color) then
           [ (fx, fy + (2 * dir)) ]
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
           |> List.concat_map (fun to_ -> promo_variants pos from to_ piece)
           |> List.filter (is_legal pos))
  in
  let castles =
    castle_specs pos
    |> List.map (fun (s : castle_spec) ->
           Castle { side = s.side; from = s.king_from })
    |> List.filter (is_legal pos)
  in
  piece_moves @ castles
