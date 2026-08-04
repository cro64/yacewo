open Yacewo
open Piece
open Game_engine
open Gui

exception PlayModeSelectionError

let instruction extend =
  print_string "\nUse ";
  ANSITerminal.print_string [ ANSITerminal.yellow ] "algebraic notation";
  print_string " to make moves.\n";
  if extend then (
    print_endline
      "     i. Chess notation uses abbreviations for each piece, using \
       capitalized letters.";
    print_endline
      "        King = K, Queen = Q, Bishop = B, Knight = N, Rook = R, Pawn has \
       no notation.";
    print_endline "        For example, Ba4 indicates moving Bishop to a4.";
    print_endline "     ii. Use \"O-O\" or \"0-0\" for castling short (king-side).";
    print_endline
      "     iii. Use \"O-O-O\" or \"0-0-0\" for castling long (queen-side).";
    print_endline "     iv. Use \"x\" to capture pieces.";
    print_endline
      "         For example, Nxe4 indicates Knight captures on e4.");
  print_string "Enter ";
  ANSITerminal.print_string [ ANSITerminal.yellow ] "Resign";
  print_endline " to resign.";
  print_string "Enter ";
  ANSITerminal.print_string [ ANSITerminal.yellow ] "Draw";
  print_endline " to offer or accept a draw.";
  if extend then (
    print_endline
      "     i. After offering a draw you still play your move.";
    print_endline
      "     ii. Opponent may accept with \"Draw\" or decline by moving.";
    print_endline "     iii. Draw offers last only until the opponent moves.";
    print_endline "     iv. Players may offer draws multiple times.");
  print_string "Enter ";
  ANSITerminal.print_string [ ANSITerminal.yellow ] "Undo";
  print_endline " to revert to your previous turn.";
  if extend then (
    print_endline "     i. Undo takes back the last half-move.";
    print_endline "     ii. You can undo multiple times.");
  print_string "Enter ";
  ANSITerminal.print_string [ ANSITerminal.yellow ] "Fen";
  print_endline " to show the current position in FEN.";
  if extend then (
    print_endline
      "     i. Enter \"Fen <fen>\" to load a position from FEN.";
    print_endline
      "        Optional 7th field: Anarchy/Chess960 seed, or Queer tag dk / dq.");
  print_string "Enter ";
  ANSITerminal.print_string [ ANSITerminal.yellow ] "Moves";
  print_endline " to show the move list.";
  print_string "Enter ";
  ANSITerminal.print_string [ ANSITerminal.yellow ] "Help";
  print_endline " to get help."

let critical_name = function
  | King -> "king"
  | Queen -> "queen"
  | _ -> "royal"

let print_status_message game = function
  | Rules.Checkmate White -> print_endline "\n Black wins by checkmate"
  | Rules.Checkmate Black -> print_endline "\n White wins by checkmate"
  | Rules.Stalemate -> print_endline "\n Draw by stalemate"
  | Rules.DrawInsufficient -> print_endline "\n Draw by insufficient material"
  | Rules.DrawAgreement -> print_endline "\n The game has ended in a mutual draw"
  | Rules.Resigned White -> print_endline " Black wins"
  | Rules.Resigned Black -> print_endline " White wins"
  | Rules.Check _ ->
      let royal = critical_name (position game).rules.critical in
      print_endline
        (Printf.sprintf
           "\n You are in check! (every %s must be safe at end of turn)" royal)
  | Rules.InProgress -> ()

let mode_label = function
  | `Classical -> "Classical Chess"
  | `Anarchy -> "Anarchy Chess"
  | `Chess960 -> "Chess960"
  | `Queer `TwoKings -> "Queer Chess — Double Kings"
  | `Queer `TwoQueens -> "Queer Chess — Double Queens"
  | `Horde -> "Horde"

let print_mode_banner mode game =
  ANSITerminal.print_string [ ANSITerminal.yellow ]
    (Printf.sprintf "Mode: %s\n" (mode_label mode));
  (match seed game with
  | Some s ->
      let label = match mode with `Chess960 -> "ID" | _ -> "Seed" in
      ANSITerminal.print_string [ ANSITerminal.yellow ]
        (Printf.sprintf "%s: %d\n" label s)
  | None -> ());
  match mode with
  | `Queer `TwoKings ->
      print_endline
        " Both kings are royal — save every king each turn. Pawns may promote \
         to king."
  | `Queer `TwoQueens ->
      print_endline
        " Both queens are royal — save every queen each turn. Pawns may promote \
         to queen or king (kings are ordinary)."
  | `Chess960 ->
      print_endline
        " FIDE Chess960 ID 0–959 (SP-518 = classical). Castling ends on c/g \
         and d/f."
  | `Anarchy ->
      print_endline " Seeded random armies; kings fixed on e1/e8."
  | `Horde ->
      print_endline
        " White: 36 pawns (rank-1 may double-step, no e.p.). Black wins by \
         capturing all white pieces; White wins by checkmate."
  | `Classical -> ()

let starts_with prefix s =
  let n = String.length prefix in
  String.length s >= n && String.sub s 0 n = prefix

let print_game_summary game =
  let moves = move_list game in
  if moves <> "" then print_endline (" Moves: " ^ moves);
  (match seed game with
  | Some s ->
      let label =
        match (position game).rules.castling with
        | Chess960 -> "ID"
        | _ -> "Seed"
      in
      print_endline (" " ^ label ^ ": " ^ string_of_int s)
  | None -> ());
  print_endline (" FEN: " ^ to_fen game)

let rec ask_seed label =
  print_string (Printf.sprintf " Enter %s seed (blank for random): " label);
  flush stdout;
  match String.trim (read_line ()) with
  | "" -> None
  | s -> (
      match int_of_string_opt s with
      | Some n when n >= 0 -> Some n
      | _ ->
          print_endline " Please enter a non-negative integer, or leave blank.";
          ask_seed label)

let rec ask_chess960_id () =
  print_string " Enter Chess960 ID 0–959 (blank for random): ";
  flush stdout;
  match String.trim (read_line ()) with
  | "" -> None
  | s -> (
      match int_of_string_opt s with
      | Some n when n >= 0 && n <= 959 -> Some n
      | _ ->
          print_endline " Please enter an integer from 0 to 959, or leave blank.";
          ask_chess960_id ())

let fen_load_note game =
  match seed game with
  | Some s -> Printf.sprintf "Loaded position from FEN (seed %d)." s
  | None -> (
      match (position game).rules with
      | { castling = Flexible; critical = King; _ } ->
          "Loaded Double Kings position from FEN (dk)."
      | { castling = Flexible; critical = Queen; _ } ->
          "Loaded Double Queens position from FEN (dq)."
      | { horde = true; _ } -> "Loaded Horde position from FEN."
      | _ -> "Loaded position from FEN.")

let rec playing_game game =
  let st = status game in
  (match st with
  | Check _ -> print_status_message game st
  | InProgress -> ()
  | terminal ->
      print_status_message game terminal;
      print_game_summary game;
      exit 0);
  (match turn game with
  | White -> print_string "\n White to move: "
  | Black -> print_string "\n Black to move: ");
  let input = read_line () in
  match String.trim input with
  | "Help" ->
      instruction true;
      playing_game game
  | "Resign" ->
      let game = resign game in
      print_status_message game (status game);
      print_game_summary game;
      exit 0
  | "Draw" ->
      let game = offer_draw game in
      if is_over game then (
        print_status_message game (status game);
        print_game_summary game;
        exit 0)
      else playing_game game
  | "Undo" -> (
      match undo game with
      | Ok game ->
          print_endline " Successfully undo move!";
          print_string (print_board (board game));
          playing_game game
      | Error e ->
          print_endline (" " ^ error_to_string e ^ ". Please play a valid move.");
          playing_game game)
  | "Moves" ->
      let moves = move_list game in
      if moves = "" then print_endline " No moves yet."
      else print_endline (" " ^ moves);
      playing_game game
  | "Fen" ->
      print_endline (" " ^ to_fen game);
      playing_game game
  | fen_cmd when starts_with "Fen " fen_cmd -> (
      let fen = String.trim (String.sub fen_cmd 4 (String.length fen_cmd - 4)) in
      match of_fen fen with
      | Ok game ->
          print_endline (" " ^ fen_load_note game);
          print_string (print_board (board game));
          playing_game game
      | Error e ->
          print_endline (" " ^ error_to_string e);
          playing_game game)
  | move_str -> (
      match apply_notation game move_str with
      | Ok game ->
          print_string (print_board (board game));
          playing_game game
      | Error (Notation Empty) ->
          print_endline " Please enter a nonempty move";
          playing_game game
      | Error (Notation Malformed) ->
          print_endline "Please enter a valid move";
          playing_game game
      | Error e ->
          print_endline ("Illegal move (" ^ error_to_string e ^ "), enter another move");
          playing_game game)

let play_mode_print () =
  ANSITerminal.print_string [ ANSITerminal.yellow ] "Choose a play mode.\n";
  print_endline " 1. Classical Chess";
  print_endline " 2. Anarchy Chess";
  print_endline " 3. Chess960";
  print_endline " 4. Queer Chess — Double Kings";
  print_endline " 5. Queer Chess — Double Queens";
  print_endline " 6. Horde \n"

let mode_of_input input =
  match String.lowercase_ascii (String.trim input) with
  | "1" | "classical chess" -> `Classical
  | "2" | "anarchy chess" -> `Anarchy
  | "3" | "chess960" -> `Chess960
  | "4" | "queer chess" | "queer" | "double kings" | "dk" -> `Queer `TwoKings
  | "5" | "double queens" | "dq" -> `Queer `TwoQueens
  | "6" | "horde" -> `Horde
  | _ -> raise PlayModeSelectionError

let rec play_mode () =
  try mode_of_input (read_line ())
  with PlayModeSelectionError ->
    play_mode_print ();
    play_mode ()

let main () =
  ANSITerminal.print_string [ ANSITerminal.red ]
    "\n\nWelcome to YACEWO — Yet Another Chess Enigma, Written in OCaml.\n";
  play_mode_print ();
  let mode = play_mode () in
  let game =
    match mode with
    | `Classical | `Horde -> create mode
    | `Queer _ as m -> create m
    | (`Anarchy | `Chess960) as m ->
        let seed =
          match m with
          | `Chess960 -> ask_chess960_id ()
          | `Anarchy -> ask_seed "Anarchy"
          | _ -> assert false
        in
        create ?seed m
  in
  print_mode_banner mode game;
  instruction false;
  ANSITerminal.print_string [ ANSITerminal.red ] "Have fun!\n";
  print_string (print_board (board game));
  playing_game game

let () = main ()
