open Piece

type error =
  | Empty
  | Malformed
  | Ambiguous
  | Illegal
  | NoMatch

let error_to_string = function
  | Empty -> "empty input"
  | Malformed -> "malformed notation"
  | Ambiguous -> "ambiguous move"
  | Illegal -> "illegal move"
  | NoMatch -> "no matching piece"

let file_of_char = function
  | 'a' .. 'h' as c -> Some (Char.code c - Char.code 'a' + 1)
  | _ -> None

let rank_of_char = function
  | '1' .. '8' as c -> Some (Char.code c - Char.code '0')
  | _ -> None

let square_of_string s =
  if String.length s <> 2 then None
  else
    match (file_of_char s.[0], rank_of_char s.[1]) with
    | Some f, Some r -> Some (f, r)
    | _ -> None

let string_of_square (f, r) =
  Printf.sprintf "%c%d" (Char.chr (Char.code 'a' + f - 1)) r

let parse_promotion rest =
  match String.split_on_char '=' rest with
  | [ _; p ] when String.length p = 1 -> (
      match char_to_kind p.[0] with
      | Some (Queen | Rook | Bishop | Knight | King as k) -> Some k
      | _ -> None)
  | [ _ ] -> None
  | _ -> None

let strip_check_chars s =
  let s = String.trim s in
  let len = String.length s in
  if len = 0 then s
  else if s.[len - 1] = '+' || s.[len - 1] = '#' then String.sub s 0 (len - 1)
  else s

let disambiguation_matches (file_hint, rank_hint) (fx, fy) =
  (match file_hint with None -> true | Some f -> fx = f)
  && (match rank_hint with None -> true | Some r -> fy = r)

(** Parse body like "e4", "Ne4", "Nbd7", "Nxe4", "exd5", "e8=Q", "axe4". *)
let parse_normal pos input =
  let input = strip_check_chars input in
  if input = "" then Error Empty
  else
    let capturing = String.contains input 'x' in
    let parts =
      if capturing then String.split_on_char 'x' input else [ input ]
    in
    let dest_and_promo =
      match List.rev parts with
      | [] -> None
      | last :: _ ->
          let promo = parse_promotion last in
          let dest_str =
            match String.split_on_char '=' last with
            | d :: _ ->
                if String.length d >= 2 then
                  String.sub d (String.length d - 2) 2
                else d
            | [] -> last
          in
          Option.map (fun sq -> (sq, promo)) (square_of_string dest_str)
    in
    match dest_and_promo with
    | None -> Error Malformed
    | Some (to_, promo_opt) ->
        let prefix =
          if capturing then List.hd parts
          else
            let without_promo =
              match String.split_on_char '=' input with
              | h :: _ -> h
              | [] -> input
            in
            if String.length without_promo >= 2 then
              String.sub without_promo 0 (String.length without_promo - 2)
            else ""
        in
        let kind, file_hint, rank_hint =
          if prefix = "" then (Pawn, None, None)
          else
            match char_to_kind prefix.[0] with
            | Some k ->
                let rest = String.sub prefix 1 (String.length prefix - 1) in
                let fh, rh =
                  match String.length rest with
                  | 0 -> (None, None)
                  | 1 -> (
                      match file_of_char rest.[0] with
                      | Some f -> (Some f, None)
                      | None -> (
                          match rank_of_char rest.[0] with
                          | Some r -> (None, Some r)
                          | None -> (None, None)))
                  | _ -> (
                      match
                        (file_of_char rest.[0], rank_of_char rest.[1])
                      with
                      | Some f, Some r -> (Some f, Some r)
                      | Some f, None -> (Some f, None)
                      | _ -> (None, None))
                in
                (k, fh, rh)
            | None ->
                (* pawn capture: "exd5" / "ed5" style prefix is file *)
                (match file_of_char prefix.[0] with
                | Some f -> (Pawn, Some f, None)
                | None -> (Pawn, None, None))
        in
        let candidates =
          Moves.legal_moves pos
          |> List.filter_map (function
               | Moves.Normal { from; to_ = t; promotion } as m
                 when t = to_ -> (
                   match Board.get pos.Position.board from with
                   | Some p
                     when p.kind = kind
                          && p.color = pos.turn
                          && disambiguation_matches (file_hint, rank_hint) from
                     ->
                       let promo_ok =
                         match (promo_opt, promotion) with
                         | None, None -> true
                         | None, Some Queen -> true (* default *)
                         | Some a, Some b -> a = b
                         | Some a, None -> a = Queen
                         | None, Some _ -> true
                       in
                       if promo_ok then Some m else None
                   | _ -> None)
               | _ -> None)
        in
        (* Prefer exact promotion match; if user omitted =X, take queen promo *)
        let candidates =
          match promo_opt with
          | Some k ->
              List.filter
                (function
                  | Moves.Normal { promotion = Some p; _ } -> p = k
                  | Moves.Normal { promotion = None; _ } -> k = Queen
                  | _ -> false)
                candidates
          | None ->
              (* collapse promo variants to queen if multiple *)
              let non_promo =
                List.filter
                  (function
                    | Moves.Normal { promotion = None; _ } -> true
                    | _ -> false)
                  candidates
              in
              if non_promo <> [] then non_promo
              else
                List.filter
                  (function
                    | Moves.Normal { promotion = Some Queen; _ } -> true
                    | Moves.Normal { promotion = None; _ } -> true
                    | _ -> false)
                  candidates
        in
        (match candidates with
        | [ m ] -> Ok m
        | [] -> Error NoMatch
        | _ -> Error Ambiguous)

let parse pos input =
  let input = String.trim input in
  if input = "" then Error Empty
  else
    match input with
    | "O-O" | "0-0" -> (
        (* Prefer e-file origin, else lowest file — legal_moves / castle_specs
           already sort that way; take first g-side castle. *)
        match
          Moves.legal_moves pos
          |> List.find_opt (function
               | Moves.Castle { side = `King; _ } -> true
               | _ -> false)
        with
        | Some m -> Ok m
        | None -> Error Illegal)
    | "O-O-O" | "0-0-0" -> (
        match
          Moves.legal_moves pos
          |> List.find_opt (function
               | Moves.Castle { side = `Queen; _ } -> true
               | _ -> false)
        with
        | Some m -> Ok m
        | None -> Error Illegal)
    | _ -> parse_normal pos input

let kind_letter = function
  | Pawn -> ""
  | Knight -> "N"
  | Bishop -> "B"
  | Rook -> "R"
  | Queen -> "Q"
  | King -> "K"

let promo_letter = function
  | Queen -> "Q"
  | Rook -> "R"
  | Bishop -> "B"
  | Knight -> "N"
  | King -> "K"
  | Pawn -> ""

(** Minimal disambiguation among other legal moves of the same piece kind. *)
let disambiguation pos kind from to_ =
  let others =
    Moves.legal_moves pos
    |> List.filter_map (function
         | Moves.Normal { from = f; to_ = t; _ } when t = to_ && f <> from -> (
             match Board.get pos.Position.board f with
             | Some p when p.kind = kind && p.color = pos.turn -> Some f
             | _ -> None)
         | _ -> None)
  in
  match others with
  | [] -> ""
  | _ ->
      let fx, fy = from in
      let same_file = List.exists (fun (f, _) -> f = fx) others in
      let same_rank = List.exists (fun (_, r) -> r = fy) others in
      if not same_file then String.make 1 (Char.chr (Char.code 'a' + fx - 1))
      else if not same_rank then string_of_int fy
      else string_of_square from

let is_capture pos move =
  match move with
  | Moves.Castle _ -> false
  | Moves.Normal { from; to_; _ } -> (
      match Board.get pos.Position.board to_ with
      | Some _ -> true
      | None -> (
          match Board.get pos.board from with
          | Some { kind = Pawn; _ } ->
              Some to_ = pos.en_passant
          | _ -> false))

let of_move pos move =
  let body =
    match move with
    | Moves.Castle { side = `King; _ } -> "O-O"
    | Moves.Castle { side = `Queen; _ } -> "O-O-O"
    | Moves.Normal { from; to_; promotion } -> (
        match Board.get pos.Position.board from with
        | None -> string_of_square to_
        | Some p ->
            let capture = is_capture pos move in
            let dest = string_of_square to_ in
            let promo =
              match promotion with
              | None -> ""
              | Some k -> "=" ^ promo_letter k
            in
            (match p.kind with
            | Pawn ->
                let prefix =
                  if capture then
                    String.make 1
                      (Char.chr (Char.code 'a' + fst from - 1))
                    ^ "x"
                  else ""
                in
                prefix ^ dest ^ promo
            | kind ->
                let x = if capture then "x" else "" in
                kind_letter kind
                ^ disambiguation pos kind from to_
                ^ x ^ dest ^ promo))
  in
  let next = Moves.apply_unchecked pos move in
  let opponent = opposite pos.turn in
  if Moves.in_check next opponent then
    if Moves.legal_moves next = [] then body ^ "#" else body ^ "+"
  else body
