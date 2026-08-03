(** Forsyth–Edwards Notation (FEN) encode / decode.

    Standard six fields, with an optional seventh field that is either a layout
    seed (Anarchy / Chess960) or a Queer tag ([dk] / [dq]):
    [placement turn castling ep halfmove fullmove [seed|dk|dq]] *)

open Piece

type error =
  | Malformed of string
  | Invalid of string

let error_to_string = function
  | Malformed s -> "malformed FEN: " ^ s
  | Invalid s -> "invalid FEN: " ^ s

let fen_char_of_piece p =
  let c =
    match p.kind with
    | Pawn -> 'p'
    | Rook -> 'r'
    | Knight -> 'n'
    | Bishop -> 'b'
    | Queen -> 'q'
    | King -> 'k'
  in
  if p.color = White then Char.uppercase_ascii c else c

let piece_of_fen_char = function
  | 'P' -> Some { kind = Pawn; color = White }
  | 'N' -> Some { kind = Knight; color = White }
  | 'B' -> Some { kind = Bishop; color = White }
  | 'R' -> Some { kind = Rook; color = White }
  | 'Q' -> Some { kind = Queen; color = White }
  | 'K' -> Some { kind = King; color = White }
  | 'p' -> Some { kind = Pawn; color = Black }
  | 'n' -> Some { kind = Knight; color = Black }
  | 'b' -> Some { kind = Bishop; color = Black }
  | 'r' -> Some { kind = Rook; color = Black }
  | 'q' -> Some { kind = Queen; color = Black }
  | 'k' -> Some { kind = King; color = Black }
  | _ -> None

let placement_of_board board =
  let buf = Buffer.create 64 in
  for rank = 8 downto 1 do
    if rank < 8 then Buffer.add_char buf '/';
    let empty = ref 0 in
    let flush_empty () =
      if !empty > 0 then (
        Buffer.add_string buf (string_of_int !empty);
        empty := 0)
    in
    for file = 1 to 8 do
      match Board.get board (file, rank) with
      | None -> incr empty
      | Some p ->
          flush_empty ();
          Buffer.add_char buf (fen_char_of_piece p)
    done;
    flush_empty ()
  done;
  Buffer.contents buf

let castling_to_fen (c : Position.castling_rights) =
  let s =
    (if c.white_king then "K" else "")
    ^ (if c.white_queen then "Q" else "")
    ^ (if c.black_king then "k" else "")
    ^ if c.black_queen then "q" else ""
  in
  if s = "" then "-" else s

let variant_tag (pos : Position.t) =
  match pos.rules.castling with
  | Flexible -> (
      match pos.rules.critical with
      | Queen -> Some "dq"
      | King -> Some "dk"
      | _ -> None)
  | Standard | Disabled -> None

let to_fen ?seed (pos : Position.t) =
  let turn = match pos.turn with White -> "w" | Black -> "b" in
  let ep =
    match pos.en_passant with
    | None -> "-"
    | Some sq -> Notation.string_of_square sq
  in
  let base =
    Printf.sprintf "%s %s %s %s %d %d" (placement_of_board pos.board) turn
      (castling_to_fen pos.castling) ep pos.halfmove pos.fullmove
  in
  match seed with
  | Some s -> Printf.sprintf "%s %d" base s
  | None -> (
      match variant_tag pos with
      | Some tag -> Printf.sprintf "%s %s" base tag
      | None -> base)

let parse_placement s =
  let ranks = String.split_on_char '/' s in
  if List.length ranks <> 8 then
    Error (Malformed "placement must have 8 ranks")
  else
    let rec rank_loop rank rows acc =
      match rows with
      | [] -> Ok acc
      | row :: rest ->
          let rec file_loop file i acc =
            if i >= String.length row then
              if file = 9 then Ok acc
              else Error (Malformed "rank does not cover 8 files")
            else
              match row.[i] with
              | '1' .. '8' as d ->
                  let n = Char.code d - Char.code '0' in
                  if file + n > 9 then
                    Error (Malformed "too many squares in rank")
                  else file_loop (file + n) (i + 1) acc
              | c -> (
                  match piece_of_fen_char c with
                  | None ->
                      Error
                        (Malformed
                           (Printf.sprintf "unknown piece '%c'" c))
                  | Some p ->
                      if file > 8 then
                        Error (Malformed "too many squares in rank")
                      else
                        file_loop (file + 1) (i + 1) (((file, rank), p) :: acc))
          in
          (match file_loop 1 0 acc with
          | Error _ as e -> e
          | Ok acc -> rank_loop (rank - 1) rest acc)
    in
    rank_loop 8 ranks []

let parse_castling = function
  | "-" -> Ok Position.no_castling
  | s ->
      let rec loop i rights =
        if i >= String.length s then Ok rights
        else
          match s.[i] with
          | 'K' -> loop (i + 1) { rights with Position.white_king = true }
          | 'Q' -> loop (i + 1) { rights with white_queen = true }
          | 'k' -> loop (i + 1) { rights with black_king = true }
          | 'q' -> loop (i + 1) { rights with black_queen = true }
          | c ->
              Error
                (Malformed (Printf.sprintf "bad castling char '%c'" c))
      in
      loop 0 Position.no_castling

let parse_int field name =
  match int_of_string_opt field with
  | Some n when n >= 0 -> Ok n
  | _ -> Error (Malformed ("bad " ^ name))

let immobile_from_board board =
  Board.all_pieces board |> List.map fst

let parse_position_fields ?rules placement turn_s castle_s ep_s half_s full_s =
  match parse_placement placement with
  | Error _ as e -> e
  | Ok pieces -> (
      let turn =
        match turn_s with
        | "w" -> Ok White
        | "b" -> Ok Black
        | _ -> Error (Malformed "turn must be 'w' or 'b'")
      in
      match turn with
      | Error _ as e -> e
      | Ok turn -> (
          match parse_castling castle_s with
          | Error _ as e -> e
          | Ok castling -> (
              let ep =
                match ep_s with
                | "-" -> Ok None
                | sq -> (
                    match Notation.square_of_string sq with
                    | Some s -> Ok (Some s)
                    | None -> Error (Malformed "bad en passant square"))
              in
              match ep with
              | Error _ as e -> e
              | Ok en_passant -> (
                  match parse_int half_s "halfmove" with
                  | Error _ as e -> e
                  | Ok halfmove -> (
                      match parse_int full_s "fullmove" with
                      | Error _ as e -> e
                      | Ok fullmove ->
                          if fullmove < 1 then
                            Error (Invalid "fullmove must be >= 1")
                          else
                            let board = Board.of_list pieces in
                            let rules =
                              match rules with
                              | Some r -> r
                              | None -> Position.rules_classical
                            in
                            let immobile =
                              match rules.castling with
                              | Flexible -> immobile_from_board board
                              | Standard | Disabled -> []
                            in
                            Ok
                              (Position.make ~turn ~castling ~en_passant
                                 ~halfmove ~fullmove ~rules ~immobile board))))))

let of_fen input =
  let fields =
    String.split_on_char ' ' (String.trim input)
    |> List.filter (fun s -> s <> "")
  in
  match fields with
  | [ placement; turn_s; castle_s; ep_s; half_s; full_s ] -> (
      match
        parse_position_fields placement turn_s castle_s ep_s half_s full_s
      with
      | Error _ as e -> e
      | Ok pos -> Ok (pos, None))
  | [ placement; turn_s; castle_s; ep_s; half_s; full_s; extra ] -> (
      let queer_rules =
        match String.lowercase_ascii extra with
        | "dk" -> Some Position.rules_double_kings
        | "dq" -> Some Position.rules_double_queens
        | _ -> None
      in
      match queer_rules with
      | Some rules -> (
          match
            parse_position_fields ~rules placement turn_s castle_s ep_s half_s
              full_s
          with
          | Error _ as e -> e
          | Ok pos -> Ok (pos, None))
      | None -> (
          match
            parse_position_fields placement turn_s castle_s ep_s half_s full_s
          with
          | Error _ as e -> e
          | Ok pos -> (
              match parse_int extra "seed" with
              | Error _ as e -> e
              | Ok seed -> Ok (pos, Some seed))))
  | _ -> Error (Malformed "expected 6 or 7 FEN fields")
