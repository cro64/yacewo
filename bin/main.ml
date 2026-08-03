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
  if extend then
    print_endline
      "     i. Enter \"Fen <fen>\" to load a position from FEN (optional 7th field = Anarchy seed).";
  print_string "Enter ";
  ANSITerminal.print_string [ ANSITerminal.yellow ] "Moves";
  print_endline " to show the move list.";
  print_string "Enter ";
  ANSITerminal.print_string [ ANSITerminal.yellow ] "Help";
  print_endline " to get help."

let print_status_message = function
  | Rules.Checkmate White -> print_endline "\n Black wins by checkmate"
  | Rules.Checkmate Black -> print_endline "\n White wins by checkmate"
  | Rules.Stalemate -> print_endline "\n Draw by stalemate"
  | Rules.DrawInsufficient -> print_endline "\n Draw by insufficient material"
  | Rules.DrawAgreement -> print_endline "\n The game has ended in a mutual draw"
  | Rules.Resigned White -> print_endline " Black wins"
  | Rules.Resigned Black -> print_endline " White wins"
  | Rules.Check _ -> print_endline "\n You are in check!"
  | Rules.InProgress -> ()

let starts_with prefix s =
  let n = String.length prefix in
  String.length s >= n && String.sub s 0 n = prefix

let print_game_summary game =
  let moves = move_list game in
  if moves <> "" then print_endline (" Moves: " ^ moves);
  (match seed game with
  | Some s -> print_endline (" Seed: " ^ string_of_int s)
  | None -> ());
  print_endline (" FEN: " ^ to_fen game)

let rec ask_anarchy_seed () =
  print_string " Enter Anarchy seed (blank for random): ";
  flush stdout;
  match String.trim (read_line ()) with
  | "" -> None
  | s -> (
      match int_of_string_opt s with
      | Some n when n >= 0 -> Some n
      | _ ->
          print_endline " Please enter a non-negative integer, or leave blank.";
          ask_anarchy_seed ())

let rec playing_game game =
  let st = status game in
  (match st with
  | Check _ -> print_status_message st
  | InProgress -> ()
  | terminal ->
      print_status_message terminal;
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
      print_status_message (status game);
      print_game_summary game;
      exit 0
  | "Draw" ->
      let game = offer_draw game in
      if is_over game then (
        print_status_message (status game);
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
          (match seed game with
          | Some s ->
              print_endline
                (" Loaded position from FEN (Anarchy seed " ^ string_of_int s
               ^ ").")
          | None -> print_endline " Loaded position from FEN.");
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
  print_endline " 2. Anarchy Chess \n"

let mode_of_input input =
  match String.lowercase_ascii (String.trim input) with
  | "1" | "classical chess" -> `Classical
  | "2" | "anarchy chess" -> `Anarchy
  | _ -> raise PlayModeSelectionError

let rec play_mode () =
  try mode_of_input (read_line ())
  with PlayModeSelectionError ->
    play_mode_print ();
    play_mode ()

let main () =
  ANSITerminal.print_string [ ANSITerminal.red ]
    "\n\nWelcome to YACEWO — Yet Another Chess Engine Written in OCaml.\n";
  play_mode_print ();
  let mode = play_mode () in
  let game =
    match mode with
    | `Classical -> create `Classical
    | `Anarchy ->
        let seed_opt = ask_anarchy_seed () in
        create ?seed:seed_opt `Anarchy
  in
  (match seed game with
  | Some s ->
      ANSITerminal.print_string [ ANSITerminal.yellow ]
        (Printf.sprintf "Anarchy seed: %d\n" s)
  | None -> ());
  instruction false;
  ANSITerminal.print_string [ ANSITerminal.red ] "Have fun!";
  print_string (print_board (board game));
  playing_game game

let () = main ()
