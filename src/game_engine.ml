open Piece

type queer_variant = [ `TwoKings | `TwoQueens ]

type mode = [ `Classical | `Anarchy | `Chess960 | `Queer of queer_variant ]

type error =
  | Notation of Notation.error
  | Fen of Fen.error
  | Illegal_move
  | Undo_unavailable
  | Game_over

let error_to_string = function
  | Notation e -> Notation.error_to_string e
  | Fen e -> Fen.error_to_string e
  | Illegal_move -> "illegal move"
  | Undo_unavailable -> "cannot undo"
  | Game_over -> "game is over"

type t = {
  position : Position.t;
  history : Position.t list;
      (** Prior positions, newest first (after each completed ply). *)
  plies : string list;
      (** Algebraic plies in chronological order (oldest first). *)
  seed : int option;
      (** Layout RNG seed when applicable (Anarchy / Chess960). *)
  white_draw : bool;
  black_draw : bool;
  terminal : Rules.status option;
      (** Set on resign / draw agreement; otherwise derived. *)
}

let fresh_seed () =
  Random.self_init ();
  Random.bits ()

let fresh_chess960_id () =
  Random.self_init ();
  Random.int 960

let empty_meta seed position =
  {
    position;
    history = [];
    plies = [];
    seed;
    white_draw = false;
    black_draw = false;
    terminal = None;
  }

let create ?seed mode =
  match mode with
  | `Classical -> empty_meta None Position.classical
  | `Anarchy ->
      let seed = match seed with Some s -> s | None -> fresh_seed () in
      empty_meta (Some seed) (Position.anarchy ~seed)
  | `Chess960 ->
      let id =
        match seed with
        | Some s -> Setup.chess960_id s
        | None -> fresh_chess960_id ()
      in
      empty_meta (Some id) (Position.chess960 ~seed:id)
  | `Queer `TwoKings -> empty_meta None Position.queer_kings
  | `Queer `TwoQueens -> empty_meta None Position.queer_queens

let of_fen fen =
  match Fen.of_fen fen with
  | Error e -> Error (Fen e)
  | Ok (position, seed) ->
      Ok
        {
          position;
          history = [];
          plies = [];
          seed;
          white_draw = false;
          black_draw = false;
          terminal = None;
        }

let to_fen g = Fen.to_fen ?seed:g.seed g.position

let seed g = g.seed

let move_list g =
  let rec pairs i = function
    | [] -> []
    | w :: b :: rest ->
        Printf.sprintf "%d. %s %s" i w b :: pairs (i + 1) rest
    | [ w ] -> [ Printf.sprintf "%d. %s" i w ]
  in
  String.concat "  " (pairs 1 g.plies)

let position g = g.position
let board g = g.position.board
let turn g = g.position.turn

let status g =
  match g.terminal with
  | Some s -> s
  | None ->
      if g.white_draw && g.black_draw then Rules.DrawAgreement
      else Rules.status_of g.position

let is_over g =
  match status g with
  | InProgress | Check _ -> false
  | _ -> true

let legal_moves g =
  if is_over g then [] else Moves.legal_moves g.position

let clear_opponent_draw g =
  match g.position.turn with
  | White -> { g with black_draw = false }
  | Black -> { g with white_draw = false }

let apply_move g move =
  if is_over g then Error Game_over
  else if not (Moves.is_legal g.position move) then Error Illegal_move
  else
    let san = Notation.of_move g.position move in
    let g = clear_opponent_draw g in
    let next = Moves.apply_unchecked g.position move in
    let g =
      {
        g with
        history = g.position :: g.history;
        plies = g.plies @ [ san ];
        position = next;
        terminal = None;
      }
    in
    let st = status g in
    let terminal =
      match st with
      | InProgress | Check _ -> None
      | other -> Some other
    in
    Ok { g with terminal }

let apply_notation g input =
  match Notation.parse g.position input with
  | Error e -> Error (Notation e)
  | Ok move -> apply_move g move

let undo g =
  match g.history with
  | prev :: rest ->
      let plies =
        match List.rev g.plies with
        | _ :: rev -> List.rev rev
        | [] -> []
      in
      Ok
        {
          position = prev;
          history = rest;
          plies;
          seed = g.seed;
          white_draw = false;
          black_draw = false;
          terminal = None;
        }
  | [] -> Error Undo_unavailable

let resign g =
  if is_over g then g
  else { g with terminal = Some (Resigned g.position.turn) }

let offer_draw g =
  if is_over g then g
  else
    let g =
      match g.position.turn with
      | White -> { g with white_draw = true }
      | Black -> { g with black_draw = true }
    in
    if g.white_draw && g.black_draw then
      { g with terminal = Some DrawAgreement }
    else g

let draw_offers g = (g.white_draw, g.black_draw)
