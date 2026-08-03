(** Browser bridge: export Game_engine to JavaScript via js_of_ocaml. *)

open Js_of_ocaml
open Yacewo
open Piece

let state : Game_engine.t option ref = ref None

let require_game () =
  match !state with
  | Some g -> g
  | None -> failwith "no game; call create first"

let set_game g = state := Some g

let color_to_js = function
  | White -> Js.string "white"
  | Black -> Js.string "black"

let kind_to_js = function
  | Pawn -> Js.string "pawn"
  | Rook -> Js.string "rook"
  | Knight -> Js.string "knight"
  | Bishop -> Js.string "bishop"
  | Queen -> Js.string "queen"
  | King -> Js.string "king"

let square_to_alg (f, r) =
  Printf.sprintf "%c%d" (Char.chr (Char.code 'a' + f - 1)) r

let alg_to_square s =
  match Notation.square_of_string s with
  | Some sq -> sq
  | None -> failwith ("bad square: " ^ s)

let piece_to_js = function
  | None -> Js.null
  | Some p ->
      Js.some
        (object%js
           val kind = kind_to_js p.kind
           val color = color_to_js p.color
        end)

let status_to_js (st : Rules.status) =
  let tag, color =
    match st with
    | InProgress -> ("in_progress", Js.null)
    | Check c -> ("check", Js.some (color_to_js c))
    | Checkmate c -> ("checkmate", Js.some (color_to_js c))
    | Stalemate -> ("stalemate", Js.null)
    | DrawInsufficient -> ("draw_insufficient", Js.null)
    | DrawAgreement -> ("draw_agreement", Js.null)
    | Resigned c -> ("resigned", Js.some (color_to_js c))
  in
  object%js
    val tag = Js.string tag
    val color = color
  end

let move_to_js = function
  | Moves.Castle `King ->
      object%js
        val kind = Js.string "castle"
        val side = Js.string "king"
        val from_ = Js.string ""
        val to_ = Js.string ""
        val promotion = Js.null
      end
  | Moves.Castle `Queen ->
      object%js
        val kind = Js.string "castle"
        val side = Js.string "queen"
        val from_ = Js.string ""
        val to_ = Js.string ""
        val promotion = Js.null
      end
  | Moves.Normal { from; to_; promotion } ->
      let promo =
        match promotion with
        | None -> Js.null
        | Some k -> Js.some (kind_to_js k)
      in
      object%js
        val kind = Js.string "normal"
        val side = Js.string ""
        val from_ = Js.string (square_to_alg from)
        val to_ = Js.string (square_to_alg to_)
        val promotion = promo
      end

let board_to_js board =
  let cells = Array.make 64 Js.null in
  for rank = 1 to 8 do
    for file = 1 to 8 do
      let i = (8 - rank) * 8 + (file - 1) in
      cells.(i) <- piece_to_js (Board.get board (file, rank))
    done
  done;
  Js.array cells

let snapshot g =
  let seed =
    match Game_engine.seed g with
    | None -> Js.null
    | Some s -> Js.some s
  in
  object%js
    val fen = Js.string (Game_engine.to_fen g)
    val moveList = Js.string (Game_engine.move_list g)
    val turn = color_to_js (Game_engine.turn g)
    val status = status_to_js (Game_engine.status g)
    val isOver = Js.bool (Game_engine.is_over g)
    val seed = seed
    val board = board_to_js (Game_engine.board g)
    val legalMoves =
      Game_engine.legal_moves g |> List.map move_to_js |> Array.of_list
      |> Js.array
  end

let result_ok g =
  set_game g;
  object%js
    val ok = Js._true
    val error = Js.null
    val game = Js.some (snapshot g)
  end

let result_err msg =
  object%js
    val ok = Js._false
    val error = Js.some (Js.string msg)
    val game = Js.null
  end

let apply_engine_result = function
  | Ok g -> result_ok g
  | Error e -> result_err (Game_engine.error_to_string e)

let create_classical () = result_ok (Game_engine.create `Classical)

let create_anarchy (seed_js : int Js.optdef) =
  let seed =
    Js.Optdef.case seed_js
      (fun () -> None)
      (fun n -> if n < 0 then None else Some n)
  in
  result_ok (Game_engine.create ?seed `Anarchy)

let of_fen fen_js =
  apply_engine_result (Game_engine.of_fen (Js.to_string fen_js))

let apply_notation notation_js =
  let g = require_game () in
  apply_engine_result
    (Game_engine.apply_notation g (Js.to_string notation_js))

let apply_move from_js to_js promo_js =
  let g = require_game () in
  let from = alg_to_square (Js.to_string from_js) in
  let to_ = alg_to_square (Js.to_string to_js) in
  let promotion =
    match Js.Opt.to_option promo_js with
    | None -> None
    | Some s -> (
        match Js.to_string s with
        | "queen" -> Some Queen
        | "rook" -> Some Rook
        | "bishop" -> Some Bishop
        | "knight" -> Some Knight
        | _ -> None)
  in
  let move = Moves.Normal { from; to_; promotion } in
  apply_engine_result (Game_engine.apply_move g move)

let apply_castle side_js =
  let g = require_game () in
  let side =
    match Js.to_string side_js with
    | "queen" -> `Queen
    | _ -> `King
  in
  apply_engine_result (Game_engine.apply_move g (Moves.Castle side))

let undo () =
  let g = require_game () in
  apply_engine_result (Game_engine.undo g)

let resign () =
  let g = require_game () in
  result_ok (Game_engine.resign g)

let offer_draw () =
  let g = require_game () in
  result_ok (Game_engine.offer_draw g)

let get_game () =
  match !state with
  | None -> Js.null
  | Some g -> Js.some (snapshot g)

let () =
  Js.export "Yacewo"
    (object%js
       method createClassical = create_classical ()
       method createAnarchy seed = create_anarchy seed
       method ofFen fen = of_fen fen
       method applyNotation n = apply_notation n
       method applyMove f t p = apply_move f t p
       method applyCastle s = apply_castle s
       method undo = undo ()
       method resign = resign ()
       method offerDraw = offer_draw ()
       method getGame = get_game ()
    end)
