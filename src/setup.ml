(** Initial positions via a small constraint + sampling pipeline.

    Two samplers share one facade:
    - Independent fill (Anarchy): fixed squares, then weighted IID on the rest
    - Constructive bag placement (Chess960, Queer core): place required pieces
      under constraints, then apply a fill policy

    Castling / check rules are not part of setup — see Moves / Rules. *)

open Piece

let mk kind color = { kind; color }

(** How leftover squares in a side's region are filled. *)
type fill =
  | Weighted_anarchy
      (** Current Anarchy weights (never draws [King]). *)
  | Empty

type side_constraint =
  | Bishops_opposite_colors
  | King_between_rooks

type side_spec = {
  region : square list;
  fixed : (square * piece_kind) list;
  bag : piece_kind list;
  constraints : side_constraint list;
  fill : fill;
}

type mode_spec =
  | Both of side_spec * side_spec
      (** Independent sides (Classical / Anarchy). *)

(* ----- helpers ----- *)

let ranks_region ranks =
  List.concat_map (fun r -> List.init 8 (fun i -> (i + 1, r))) ranks

let back_rank color = if color = White then 1 else 8
let pawn_rank color = if color = White then 2 else 7

let square_color (f, r) = (f + r) mod 2
(** 0 and 1 are opposite colors; a1 = (1,1) → 0. *)

let remove_sq sq = List.filter (fun s -> s <> sq)

let pick_nth n lst =
  let rec loop i = function
    | [] -> failwith "Setup.pick_nth: empty"
    | x :: xs -> if i = 0 then x else loop (i - 1) xs
  in
  loop n lst

let choose_one lst =
  pick_nth (Random.int (List.length lst)) lst

(** Combinations: choose [k] distinct elements from [lst], preserving relative
    order of chosen elements. Returns all C(n,k) lists. *)
let combinations k lst =
  let rec comb k = function
    | _ when k = 0 -> [ [] ]
    | [] -> []
    | x :: xs ->
        List.map (fun rest -> x :: rest) (comb (k - 1) xs) @ comb k xs
  in
  comb k lst

let choose_k k lst =
  let opts = combinations k lst in
  pick_nth (Random.int (List.length opts)) opts

let mirror_sq (f, r) = (f, 9 - r)

let mirror_side white_pieces =
  List.map
    (fun (sq, p) -> (mirror_sq sq, { p with color = Black }))
    white_pieces

(* ----- fill policies ----- *)

(** Historical Anarchy weights: Pawn 8/15, R/N/B 2/15 each, Queen 1/15.
    Never draws [King]. *)
let random_kind_anarchy () =
  let r = Random.int 15 in
  if r <= 7 then Pawn
  else if r <= 9 then Rook
  else if r <= 11 then Knight
  else if r <= 13 then Bishop
  else Queen

let fill_square policy =
  match policy with
  | Weighted_anarchy -> random_kind_anarchy ()
  | Empty -> failwith "Setup.fill_square: Empty has no kind"

(* ----- bag placement under constraints ----- *)

let has_constraint c spec = List.mem c spec.constraints

(** Place Chess960-style bag on an 8-square back rank (constructive, uniform). *)
let place_chess960_back files =
  (* files: eight squares on one rank, file order a→h *)
  let light = List.filter (fun sq -> square_color sq = 1) files in
  let dark = List.filter (fun sq -> square_color sq = 0) files in
  let b_light = choose_one light in
  let b_dark = choose_one dark in
  let remaining =
    files |> remove_sq b_light |> remove_sq b_dark
  in
  let q_sq = choose_one remaining in
  let remaining = remove_sq q_sq remaining in
  let n1_sq, n2_sq =
    match choose_k 2 remaining with
    | [ a; b ] -> (a, b)
    | _ -> failwith "Setup.place_chess960_back: knights"
  in
  let remaining = remaining |> remove_sq n1_sq |> remove_sq n2_sq in
  (* Last three files left-to-right: Rook, King, Rook *)
  let remaining = List.sort (fun (f1, _) (f2, _) -> compare f1 f2) remaining in
  match remaining with
  | [ r1; k; r2 ] ->
      [
        (b_light, Bishop);
        (b_dark, Bishop);
        (q_sq, Queen);
        (n1_sq, Knight);
        (n2_sq, Knight);
        (r1, Rook);
        (k, King);
        (r2, Rook);
      ]
  | _ -> failwith "Setup.place_chess960_back: expected 3 squares"

let place_bag_random region bag =
  let rec loop free = function
    | [] -> []
    | kind :: rest ->
        let sq = choose_one free in
        (sq, kind) :: loop (remove_sq sq free) rest
  in
  loop region bag

(** Place Queer required pieces: both kings on the back-rank subset of [region],
    then queens on any remaining region squares. *)
let place_queer_bag region bag =
  let kings = List.filter (fun k -> k = King) bag in
  let queens = List.filter (fun k -> k = Queen) bag in
  let other = List.filter (fun k -> k <> King && k <> Queen) bag in
  let back =
    match region with
    | [] -> []
    | _ :: _ ->
        let ranks = List.map snd region in
        let back_r = List.fold_left min max_int ranks in
        List.filter (fun (_, r) -> r = back_r) region
  in
  let n_kings = List.length kings in
  let king_sqs = choose_k n_kings back in
  let free = List.fold_left (fun acc sq -> remove_sq sq acc) region king_sqs in
  let queen_sqs = choose_k (List.length queens) free in
  let free =
    List.fold_left (fun acc sq -> remove_sq sq acc) free queen_sqs
  in
  let king_place = List.map2 (fun sq _ -> (sq, King)) king_sqs kings in
  let queen_place = List.map2 (fun sq _ -> (sq, Queen)) queen_sqs queens in
  let other_place = place_bag_random free other in
  king_place @ queen_place @ other_place

let place_required spec =
  match spec.bag with
  | [] -> []
  | bag ->
      if has_constraint Bishops_opposite_colors spec
         || has_constraint King_between_rooks spec
      then
        (* Chess960 constructive path: bag ignored structurally; region must be
           an 8-square back rank. *)
        let files =
          List.sort (fun (f1, _) (f2, _) -> compare f1 f2) spec.region
        in
        place_chess960_back files
      else if List.mem King bag && List.mem Queen bag then place_queer_bag spec.region bag
      else place_bag_random spec.region bag

(* ----- side generation ----- *)

let occupied_of placements = List.map fst placements

let generate_side color spec =
  let fixed_place =
    List.map (fun (sq, k) -> (sq, mk k color)) spec.fixed
  in
  let occupied = occupied_of fixed_place in
  let region_free =
    List.filter (fun sq -> not (List.mem sq occupied)) spec.region
  in
  (* Temporarily restrict bag placement to free squares. *)
  let spec = { spec with region = region_free } in
  let bag_place =
    List.map (fun (sq, k) -> (sq, mk k color)) (place_required spec)
  in
  let occupied = occupied @ occupied_of bag_place in
  let leftovers =
    List.filter (fun sq -> not (List.mem sq occupied)) region_free
  in
  let fill_place =
    match spec.fill with
    | Empty -> []
    | policy ->
        List.map
          (fun sq -> (sq, mk (fill_square policy) color))
          leftovers
  in
  fixed_place @ bag_place @ fill_place

let generate = function
  | Both (w, b) -> generate_side White w @ generate_side Black b

(* ----- mode specs ----- *)

let classical_side_spec color =
  let back = back_rank color in
  let pawn_r = pawn_rank color in
  {
    region = ranks_region [ back; pawn_r ];
    fixed =
      [
        ((1, back), Rook);
        ((2, back), Knight);
        ((3, back), Bishop);
        ((4, back), Queen);
        ((5, back), King);
        ((6, back), Bishop);
        ((7, back), Knight);
        ((8, back), Rook);
      ]
      @ List.init 8 (fun i -> ((i + 1, pawn_r), Pawn));
    bag = [];
    constraints = [];
    fill = Empty;
  }

let classical =
  generate (Both (classical_side_spec White, classical_side_spec Black))

let anarchy_side_spec color =
  let ranks = if color = White then [ 1; 2 ] else [ 7; 8 ] in
  let king_sq = (5, back_rank color) in
  {
    region = ranks_region ranks;
    fixed = [ (king_sq, King) ];
    bag = [];
    constraints = [];
    fill = Weighted_anarchy;
  }

let anarchy ~seed =
  Random.init seed;
  generate (Both (anarchy_side_spec White, anarchy_side_spec Black))

(** Normalize to the FIDE / Scharnagl Chess960 range [0, 959]. *)
let chess960_id id =
  let id = id mod 960 in
  if id < 0 then id + 960 else id

(** White back-rank piece kinds a→h from FIDE Chess960 ID (Scharnagl).
    SP-518 is the classical [RNBQKBNR]; SP-0 is [BBQNNRKR]. *)
let chess960_back_kinds id =
  let id = chess960_id id in
  let rank = Array.make 8 None in
  let place file kind = rank.(file) <- Some kind in
  let empties () =
    List.filter (fun i -> rank.(i) = None) [ 0; 1; 2; 3; 4; 5; 6; 7 ]
  in
  (* Light-squared bishop: b d f h *)
  let b1 = id mod 4 in
  let n2 = id / 4 in
  place ((2 * b1) + 1) Bishop;
  (* Dark-squared bishop: a c e g *)
  let b2 = n2 mod 4 in
  let n3 = n2 / 4 in
  place (2 * b2) Bishop;
  (* Queen on the Q-th empty square (a→h) *)
  let q = n3 mod 6 in
  let n4 = n3 / 6 in
  place (List.nth (empties ()) q) Queen;
  (* Knights on two of the five remaining empties (N5N table) *)
  let knight_pairs =
    [|
      (0, 1);
      (0, 2);
      (0, 3);
      (0, 4);
      (1, 2);
      (1, 3);
      (1, 4);
      (2, 3);
      (2, 4);
      (3, 4);
    |]
  in
  let free = empties () in
  let i1, i2 = knight_pairs.(n4) in
  place (List.nth free i1) Knight;
  place (List.nth free i2) Knight;
  (* Remaining three: Rook, King, Rook *)
  (match empties () with
  | [ a; b; c ] ->
      place a Rook;
      place b King;
      place c Rook
  | _ -> failwith "Setup.chess960_back_kinds: expected 3 squares");
  Array.to_list rank
  |> List.map (function
       | Some k -> k
       | None -> failwith "Setup.chess960_back_kinds: hole")

let chess960 ~seed =
  let id = chess960_id seed in
  let kinds = chess960_back_kinds id in
  let white_back =
    List.mapi
      (fun i kind -> ((i + 1, 1), mk kind White))
      kinds
  in
  let white_pawns =
    List.init 8 (fun i -> ((i + 1, 2), mk Pawn White))
  in
  let white = white_back @ white_pawns in
  white @ mirror_side white

(** Homonormative-chess layouts: classical with d+e both kings or both queens. *)
let queer_side variant color =
  let back = back_rank color in
  let pawn_r = pawn_rank color in
  let royal =
    match variant with
    | `TwoKings -> King
    | `TwoQueens -> Queen
  in
  let back_row =
    [
      ((1, back), Rook);
      ((2, back), Knight);
      ((3, back), Bishop);
      ((4, back), royal);
      ((5, back), royal);
      ((6, back), Bishop);
      ((7, back), Knight);
      ((8, back), Rook);
    ]
  in
  let pawns = List.init 8 (fun i -> ((i + 1, pawn_r), Pawn)) in
  List.map (fun (sq, k) -> (sq, mk k color)) (back_row @ pawns)

let queer_kings =
  queer_side `TwoKings White @ queer_side `TwoKings Black

let queer_queens =
  queer_side `TwoQueens White @ queer_side `TwoQueens Black
