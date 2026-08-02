open Piece

type mode = [ `Classical | `Anarchy ]

type error =
  | Notation of Notation.error
  | Illegal_move
  | Undo_unavailable
  | Game_over

let error_to_string = function
  | Notation e -> Notation.error_to_string e
  | Illegal_move -> "illegal move"
  | Undo_unavailable -> "cannot undo"
  | Game_over -> "game is over"

type t = {
  position : Position.t;
  history : Position.t list;
      (** Prior positions, newest first (after each completed ply). *)
  white_draw : bool;
  black_draw : bool;
  terminal : Rules.status option;
      (** Set on resign / draw agreement; otherwise derived. *)
}

let create ?seed mode =
  let position =
    match mode with
    | `Classical -> Position.classical
    | `Anarchy -> Position.anarchy ?seed ()
  in
  {
    position;
    history = [];
    white_draw = false;
    black_draw = false;
    terminal = None;
  }

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
    let g = clear_opponent_draw g in
    let next = Moves.apply_unchecked g.position move in
    let g =
      {
        g with
        history = g.position :: g.history;
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
  (* Remove the opponent's last ply and this player's previous ply so the
     same side is to move again (matches original CLI undo). *)
  match g.history with
  | _opponent :: prev :: rest ->
      Ok
        {
          position = prev;
          history = rest;
          white_draw = false;
          black_draw = false;
          terminal = None;
        }
  | _ -> Error Undo_unavailable

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
