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
      | Some (Queen | Rook | Bishop | Knight as k) -> Some k
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
    | "O-O" | "0-0" ->
        if Moves.is_legal pos (Moves.Castle `King) then Ok (Moves.Castle `King)
        else Error Illegal
    | "O-O-O" | "0-0-0" ->
        if Moves.is_legal pos (Moves.Castle `Queen) then Ok (Moves.Castle `Queen)
        else Error Illegal
    | _ -> parse_normal pos input
