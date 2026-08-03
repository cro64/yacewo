open OUnit2
open Yacewo
open Piece
open Board
open Position
open Moves
open Rules
open Notation
open Game_engine

(* Test plan: black-box coverage of the Game_engine / Moves / Rules / Notation
   API — setup, movement, captures, en passant, castling, promotion, check,
   undo, insufficient material — plus glass-box edge cases. *)

let piece kind color = { kind; color }

let pos_of ?(turn = White) ?(castling = all_castling) ?(en_passant = None)
    ?(rules = rules_classical) ?(immobile = []) pieces =
  of_pieces ~turn ~castling ~en_passant ~rules ~immobile pieces

let must_ok = function
  | Ok x -> x
  | Error e -> failwith (error_to_string e)

let must_parse pos s =
  match parse pos s with
  | Ok m -> m
  | Error e -> failwith (error_to_string (Notation e))

let apply_str g s = must_ok (apply_notation g s)

let count_color board color = List.length (pieces_of board color)

(* ---------- setup ---------- *)

let classical_setup_tests =
  let g = create `Classical in
  let b = board g in
  [
    ( "classical has 32 pieces" >:: fun _ ->
      assert_equal 32 (List.length (all_pieces b)) );
    ( "classical 16 white" >:: fun _ -> assert_equal 16 (count_color b White) );
    ( "classical 16 black" >:: fun _ -> assert_equal 16 (count_color b Black) );
    ( "white to move" >:: fun _ -> assert_equal White (turn g) );
    ( "king on e1" >:: fun _ ->
      assert_equal
        (Some { kind = King; color = White })
        (get b (5, 1)) );
    ( "anarchy keeps kings" >:: fun _ ->
      let g = create ~seed:42 `Anarchy in
      assert_equal
        (Some { kind = King; color = White })
        (get (board g) (5, 1));
      assert_equal
        (Some { kind = King; color = Black })
        (get (board g) (5, 8)) );
    ( "anarchy seed 42 golden fen" >:: fun _ ->
      let g = create ~seed:42 `Anarchy in
      assert_equal
        "bbnnkppq/pnpppppp/8/8/8/8/PQPBPRPP/PPPQKBBR w KQkq - 0 1 42"
        (to_fen g) );
    ( "chess960 bishops opposite colors" >:: fun _ ->
      let g = create ~seed:7 `Chess960 in
      let b = board g in
      let bishops =
        List.filter
          (fun (_, p) -> p.kind = Bishop && p.color = White)
          (all_pieces b)
      in
      match bishops with
      | [ ((f1, r1), _); ((f2, r2), _) ] ->
          assert_equal 1 r1;
          assert_equal 1 r2;
          assert_bool "opposite colors"
            ((f1 + r1) mod 2 <> (f2 + r2) mod 2)
      | _ -> assert_failure "expected two white bishops" );
    ( "chess960 king between rooks" >:: fun _ ->
      let g = create ~seed:7 `Chess960 in
      let b = board g in
      let on_back kind =
        List.filter_map
          (fun (sq, p) ->
            if p.kind = kind && p.color = White && snd sq = 1 then Some (fst sq)
            else None)
          (all_pieces b)
      in
      let kf = List.hd (on_back King) in
      match on_back Rook with
      | [ a; c ] ->
          let lo, hi = if a < c then (a, c) else (c, a) in
          assert_bool "king between" (lo < kf && kf < hi)
      | _ -> assert_failure "expected two white rooks" );
    ( "chess960 black mirrors white" >:: fun _ ->
      let g = create ~seed:7 `Chess960 in
      let b = board g in
      for file = 1 to 8 do
        match (get b (file, 1), get b (file, 8)) with
        | Some w, Some bl ->
            assert_equal w.kind bl.kind;
            assert_equal White w.color;
            assert_equal Black bl.color
        | _ -> assert_failure "missing back-rank piece"
      done );
    ( "chess960 no castling rights" >:: fun _ ->
      let g = create ~seed:7 `Chess960 in
      let fen = to_fen g in
      let parts = String.split_on_char ' ' fen in
      assert_equal "-" (List.nth parts 2) );
    ( "chess960 seed stable" >:: fun _ ->
      let a = to_fen (create ~seed:99 `Chess960) in
      let b = to_fen (create ~seed:99 `Chess960) in
      assert_equal a b );
    ( "queer double kings layout" >:: fun _ ->
      let g = create (`Queer `TwoKings) in
      let b = board g in
      assert_equal
        (Some { kind = King; color = White })
        (get b (4, 1));
      assert_equal
        (Some { kind = King; color = White })
        (get b (5, 1));
      assert_equal None
        (List.find_opt (fun (_, p) -> p.kind = Queen) (all_pieces b));
      assert_bool "dk tag" (Filename.check_suffix (to_fen g) " dk") );
    ( "queer double queens layout" >:: fun _ ->
      let g = create (`Queer `TwoQueens) in
      let b = board g in
      assert_equal
        (Some { kind = Queen; color = White })
        (get b (4, 1));
      assert_equal
        (Some { kind = Queen; color = White })
        (get b (5, 1));
      assert_equal None
        (List.find_opt (fun (_, p) -> p.kind = King) (all_pieces b));
      assert_bool "dq tag" (Filename.check_suffix (to_fen g) " dq") );
    ( "queer kings both must escape check" >:: fun _ ->
      (* Two white kings on e1/d1; black rook attacks e1 only — white may not
         ignore it. *)
      let pos =
        pos_of ~rules:rules_double_kings ~immobile:[]
          [
            ((4, 1), piece King White);
            ((5, 1), piece King White);
            ((5, 8), piece Rook Black);
            ((1, 8), piece King Black);
            ((2, 8), piece King Black);
          ]
      in
      assert_bool "in check" (in_check pos White);
      let flee =
        Normal { from = (5, 1); to_ = (6, 1); promotion = None }
      in
      (* fleeing e-king leaves it still on e-file attacked? 6,1 not attacked by
         rook on e8. d-king safe. Should be legal. *)
      assert_bool "flee legal" (is_legal pos flee) );
    ( "queer queens critical check" >:: fun _ ->
      let pos =
        pos_of ~rules:rules_double_queens ~immobile:[]
          [
            ((4, 1), piece Queen White);
            ((5, 1), piece Queen White);
            ((5, 8), piece Rook Black);
            ((1, 8), piece Queen Black);
            ((2, 8), piece Queen Black);
          ]
      in
      assert_bool "queen in check" (in_check pos White) );
    ( "queer kings d-file O-O-O" >:: fun _ ->
      let pos =
        pos_of ~rules:rules_double_kings
          ~immobile:[ (4, 1); (1, 1); (5, 1); (8, 1) ]
          [
            ((4, 1), piece King White);
            ((5, 1), piece King White);
            ((1, 1), piece Rook White);
            ((8, 1), piece Rook White);
            ((4, 8), piece King Black);
            ((5, 8), piece King Black);
          ]
      in
      let m = Castle { side = `Queen; from = (4, 1) } in
      assert_bool "d-king O-O-O" (is_legal pos m);
      let next = apply_unchecked pos m in
      assert_equal
        (Some { kind = King; color = White })
        (get next.board (2, 1));
      assert_equal
        (Some { kind = Rook; color = White })
        (get next.board (3, 1)) );
    ( "queer fen round-trip" >:: fun _ ->
      let g = create (`Queer `TwoQueens) in
      let fen = to_fen g in
      let g2 = must_ok (of_fen fen) in
      assert_equal fen (to_fen g2);
      assert_equal Queen (position g2).rules.critical );
  ]

(* ---------- notation / basic moves ---------- *)

let play moves =
  List.fold_left apply_str (create `Classical) moves

let notation_tests =
  [
    ( "pawn e4" >:: fun _ ->
      let g = apply_str (create `Classical) "e4" in
      assert_equal
        (Some { kind = Pawn; color = White })
        (get (board g) (5, 4));
      assert_equal None (get (board g) (5, 2));
      assert_equal Black (turn g) );
    ( "knight Nf3" >:: fun _ ->
      let g = apply_str (create `Classical) "Nf3" in
      assert_equal
        (Some { kind = Knight; color = White })
        (get (board g) (6, 3)) );
    ( "illegal empty" >:: fun _ ->
      assert_equal (Error (Notation Empty)) (apply_notation (create `Classical) "") );
    ( "illegal move rejected" >:: fun _ ->
      match apply_notation (create `Classical) "e5" with
      | Error _ -> ()
      | Ok _ -> assert_failure "e5 should be illegal for white" );
    ( "scholars opening sequence" >:: fun _ ->
      let g = play [ "e4"; "e5"; "Bc4"; "Nc6"; "Qh5"; "Nf6" ] in
      assert_equal White (turn g);
      assert_equal
        (Some { kind = Queen; color = White })
        (get (board g) (8, 5)) );
  ]

(* ---------- captures ---------- *)

let capture_tests =
  [
    ( "bishop capture" >:: fun _ ->
      let pos =
        pos_of
          [
            ((4, 4), piece Bishop White);
            ((1, 7), piece Pawn Black);
            ((5, 1), piece King White);
            ((5, 8), piece King Black);
          ]
      in
      let m = must_parse pos "Bxa7" in
      let next = apply_unchecked pos m in
      assert_equal
        (Some { kind = Bishop; color = White })
        (get next.board (1, 7));
      assert_equal None (get next.board (4, 4)) );
    ( "knight capture" >:: fun _ ->
      let pos =
        pos_of
          [
            ((3, 3), piece Knight White);
            ((4, 5), piece Pawn Black);
            ((5, 1), piece King White);
            ((5, 8), piece King Black);
          ]
      in
      let m = must_parse pos "Nxd5" in
      let next = apply_unchecked pos m in
      assert_equal
        (Some { kind = Knight; color = White })
        (get next.board (4, 5)) );
  ]

(* ---------- en passant ---------- *)

let en_passant_tests =
  [
    ( "en passant capture" >:: fun _ ->
      (* White pawn e5, black just played d7-d5 → ep target d6 *)
      let pos =
        pos_of ~turn:White ~en_passant:(Some (4, 6))
          [
            ((5, 5), piece Pawn White);
            ((4, 5), piece Pawn Black);
            ((5, 1), piece King White);
            ((5, 8), piece King Black);
          ]
      in
      assert_bool "exd6 legal" (is_legal pos (must_parse pos "exd6"));
      let next = apply_unchecked pos (must_parse pos "exd6") in
      assert_equal
        (Some { kind = Pawn; color = White })
        (get next.board (4, 6));
      assert_equal None (get next.board (4, 5));
      assert_equal None next.en_passant );
    ( "double push sets ep" >:: fun _ ->
      let g = apply_str (create `Classical) "e4" in
      assert_equal (Some (5, 3)) (position g).en_passant );
  ]

(* ---------- castling ---------- *)

let castling_tests =
  [
    ( "white O-O" >:: fun _ ->
      let pos =
        pos_of
          [
            ((5, 1), piece King White);
            ((8, 1), piece Rook White);
            ((5, 8), piece King Black);
          ]
      in
      let next = apply_unchecked pos (Castle { side = `King; from = (5, 1) }) in
      assert_equal
        (Some { kind = King; color = White })
        (get next.board (7, 1));
      assert_equal
        (Some { kind = Rook; color = White })
        (get next.board (6, 1)) );
    ( "white O-O-O" >:: fun _ ->
      let pos =
        pos_of
          [
            ((5, 1), piece King White);
            ((1, 1), piece Rook White);
            ((5, 8), piece King Black);
          ]
      in
      let next = apply_unchecked pos (Castle { side = `Queen; from = (5, 1) }) in
      assert_equal
        (Some { kind = King; color = White })
        (get next.board (3, 1));
      assert_equal
        (Some { kind = Rook; color = White })
        (get next.board (4, 1)) );
    ( "cannot castle through check" >:: fun _ ->
      let pos =
        pos_of
          [
            ((5, 1), piece King White);
            ((8, 1), piece Rook White);
            ((6, 8), piece Rook Black);
            ((5, 8), piece King Black);
          ]
      in
      assert_bool "O-O illegal" (not (is_legal pos (Castle { side = `King; from = (5, 1) }))) );
    ( "cannot castle after king move" >:: fun _ ->
      let pos =
        pos_of
          ~castling:
            {
              white_king = false;
              white_queen = false;
              black_king = true;
              black_queen = true;
            }
          [
            ((5, 1), piece King White);
            ((8, 1), piece Rook White);
            ((5, 8), piece King Black);
          ]
      in
      assert_bool "no castle" (not (is_legal pos (Castle { side = `King; from = (5, 1) }))) );
    ( "cannot castle in check" >:: fun _ ->
      let pos =
        pos_of
          [
            ((5, 1), piece King White);
            ((8, 1), piece Rook White);
            ((5, 8), piece Rook Black);
            ((4, 8), piece King Black);
          ]
      in
      assert_bool "in check" (in_check pos White);
      assert_bool "no castle" (not (is_legal pos (Castle { side = `King; from = (5, 1) }))) );
    ( "notation O-O" >:: fun _ ->
      let pos =
        pos_of
          [
            ((5, 1), piece King White);
            ((8, 1), piece Rook White);
            ((5, 8), piece King Black);
          ]
      in
      assert_equal (Ok (Castle { side = `King; from = (5, 1) })) (parse pos "O-O") );
  ]

(* ---------- promotion ---------- *)

let promo_kinds_of moves =
  moves
  |> List.filter_map (function
       | Normal { from = (1, 7); to_ = (1, 8); promotion = Some k } -> Some k
       | _ -> None)
  |> List.sort compare

let classical_promo_pos ?(turn = White) () =
  pos_of ~turn
    [
      ((1, 7), piece Pawn White);
      ((5, 1), piece King White);
      ((5, 8), piece King Black);
    ]

(** Block d/e so opposing royals are not already in check on open files. *)
let double_kings_promo_pos () =
  pos_of ~rules:rules_double_kings
    [
      ((1, 7), piece Pawn White);
      ((4, 1), piece King White);
      ((5, 1), piece King White);
      ((4, 8), piece King Black);
      ((5, 8), piece King Black);
      ((4, 4), piece Pawn White);
      ((5, 4), piece Pawn White);
    ]

let double_queens_promo_pos () =
  pos_of ~rules:rules_double_queens
    [
      ((1, 7), piece Pawn White);
      ((4, 1), piece Queen White);
      ((5, 1), piece Queen White);
      ((4, 8), piece Queen Black);
      ((5, 8), piece Queen Black);
      ((4, 4), piece Pawn White);
      ((5, 4), piece Pawn White);
    ]

let promotion_tests =
  [
    ( "classical promote to queen by default" >:: fun _ ->
      let pos = classical_promo_pos () in
      let m = Normal { from = (1, 7); to_ = (1, 8); promotion = None } in
      let next = apply_unchecked pos m in
      assert_equal
        (Some { kind = Queen; color = White })
        (get next.board (1, 8)) );
    ( "classical promote to knight with =N" >:: fun _ ->
      let pos = classical_promo_pos () in
      let m = must_parse pos "a8=N" in
      let next = apply_unchecked pos m in
      assert_equal
        (Some { kind = Knight; color = White })
        (get next.board (1, 8)) );
    ( "classical rejects =K" >:: fun _ ->
      let pos = classical_promo_pos () in
      let m = Normal { from = (1, 7); to_ = (1, 8); promotion = Some King } in
      assert_bool "pseudo illegal" (not (is_pseudo_legal pos m));
      assert_bool "illegal" (not (is_legal pos m)) );
    ( "classical legal_moves offers Q R B N only" >:: fun _ ->
      let pos = classical_promo_pos () in
      (* piece_kind compare order: Rook < Knight < Bishop < Queen *)
      assert_equal [ Rook; Knight; Bishop; Queen ]
        (promo_kinds_of (Moves.legal_moves pos)) );
    ( "anarchy ruleset rejects =K" >:: fun _ ->
      let pos =
        pos_of ~rules:rules_anarchy
          [
            ((1, 7), piece Pawn White);
            ((5, 1), piece King White);
            ((5, 8), piece King Black);
          ]
      in
      let m = Normal { from = (1, 7); to_ = (1, 8); promotion = Some King } in
      assert_bool "illegal" (not (is_legal pos m)) );
    ( "chess960 ruleset rejects =K" >:: fun _ ->
      let pos =
        pos_of ~rules:rules_chess960 ~castling:no_castling
          [
            ((1, 7), piece Pawn White);
            ((5, 1), piece King White);
            ((5, 8), piece King Black);
          ]
      in
      let m = Normal { from = (1, 7); to_ = (1, 8); promotion = Some King } in
      assert_bool "illegal" (not (is_legal pos m)) );
    ( "double kings allows =K and king is critical" >:: fun _ ->
      let pos = double_kings_promo_pos () in
      let m = Normal { from = (1, 7); to_ = (1, 8); promotion = Some King } in
      assert_bool "legal" (is_legal pos m);
      let next = apply_unchecked pos m in
      assert_equal
        (Some { kind = King; color = White })
        (get next.board (1, 8));
      let attacked =
        pos_of ~turn:White ~rules:rules_double_kings
          [
            ((1, 8), piece King White);
            ((4, 1), piece King White);
            ((5, 1), piece King White);
            ((4, 8), piece King Black);
            ((5, 8), piece King Black);
            ((4, 4), piece Pawn White);
            ((5, 4), piece Pawn White);
            ((1, 1), piece Rook Black);
          ]
      in
      assert_bool "promoted king in check" (in_check attacked White) );
    ( "double kings legal_moves includes King" >:: fun _ ->
      let pos = double_kings_promo_pos () in
      assert_equal [ Rook; Knight; Bishop; Queen; King ]
        (promo_kinds_of (Moves.legal_moves pos)) );
    ( "double queens allows =K as non-critical" >:: fun _ ->
      let pos = double_queens_promo_pos () in
      let m = Normal { from = (1, 7); to_ = (1, 8); promotion = Some King } in
      assert_bool "legal" (is_legal pos m);
      let next = apply_unchecked pos m in
      assert_equal
        (Some { kind = King; color = White })
        (get next.board (1, 8));
      let attacked =
        pos_of ~turn:White ~rules:rules_double_queens
          [
            ((1, 8), piece King White);
            ((4, 1), piece Queen White);
            ((5, 1), piece Queen White);
            ((4, 8), piece Queen Black);
            ((5, 8), piece Queen Black);
            ((4, 4), piece Pawn White);
            ((5, 4), piece Pawn White);
            ((1, 7), piece Rook Black);
          ]
      in
      assert_bool "ordinary king ignored" (not (in_check attacked White)) );
    ( "double queens =Q remains critical" >:: fun _ ->
      let pos =
        pos_of ~turn:White ~rules:rules_double_queens
          [
            ((1, 8), piece Queen White);
            ((5, 1), piece Queen White);
            ((4, 8), piece Queen Black);
            ((5, 8), piece Queen Black);
            ((5, 4), piece Pawn White);
            ((1, 1), piece Rook Black);
          ]
      in
      assert_bool "queen in check" (in_check pos White) );
    ( "black promotion to queen" >:: fun _ ->
      let pos =
        pos_of ~turn:Black
          [
            ((1, 2), piece Pawn Black);
            ((5, 1), piece King White);
            ((5, 8), piece King Black);
          ]
      in
      let m = Normal { from = (1, 2); to_ = (1, 1); promotion = Some Queen } in
      assert_bool "legal" (is_legal pos m);
      let next = apply_unchecked pos m in
      assert_equal
        (Some { kind = Queen; color = Black })
        (get next.board (1, 1)) );
    ( "capture promotion" >:: fun _ ->
      let pos =
        pos_of
          [
            ((1, 7), piece Pawn White);
            ((2, 8), piece Rook Black);
            ((5, 1), piece King White);
            ((5, 8), piece King Black);
          ]
      in
      let m =
        Normal { from = (1, 7); to_ = (2, 8); promotion = Some Rook }
      in
      assert_bool "legal" (is_legal pos m);
      let next = apply_unchecked pos m in
      assert_equal
        (Some { kind = Rook; color = White })
        (get next.board (2, 8));
      assert_equal None (get next.board (1, 7)) );
    ( "promo flag illegal when not promoting" >:: fun _ ->
      let pos =
        pos_of
          [
            ((1, 2), piece Pawn White);
            ((5, 1), piece King White);
            ((5, 8), piece King Black);
          ]
      in
      let m = Normal { from = (1, 2); to_ = (1, 3); promotion = Some Queen } in
      assert_bool "illegal" (not (is_pseudo_legal pos m)) );
    ( "double queens notation a8=K" >:: fun _ ->
      let pos = double_queens_promo_pos () in
      let m = must_parse pos "a8=K" in
      match m with
      | Normal { promotion = Some King; _ } -> ()
      | _ -> assert_failure "expected king promotion" );
  ]

(* ---------- check / mate / stalemate ---------- *)

let check_tests =
  [
    ( "discovered style check" >:: fun _ ->
      let pos =
        pos_of ~turn:Black
          [
            ((5, 1), piece King White);
            ((5, 4), piece Rook White);
            ((5, 8), piece King Black);
          ]
      in
      assert_bool "black in check" (in_check pos Black) );
    ( "cannot move into check" >:: fun _ ->
      let pos =
        pos_of
          [
            ((5, 1), piece King White);
            ((5, 8), piece Rook Black);
            ((4, 8), piece King Black);
          ]
      in
      let m = Normal { from = (5, 1); to_ = (5, 2); promotion = None } in
      assert_bool "illegal" (not (is_legal pos m)) );
    ( "back rank mate" >:: fun _ ->
      let pos =
        pos_of ~turn:White
          [
            ((5, 1), piece King White);
            ((1, 1), piece Rook Black);
            ((4, 2), piece Pawn White);
            ((5, 2), piece Pawn White);
            ((6, 2), piece Pawn White);
            ((5, 8), piece King Black);
          ]
      in
      assert_equal (Checkmate White) (status_of pos) );
    ( "stalemate" >:: fun _ ->
      (* Ka8, Kb6, Pc7: a7/b7 by king, b8 by pawn; a8 not in check. *)
      let pos =
        pos_of ~turn:Black
          [
            ((1, 8), piece King Black);
            ((2, 6), piece King White);
            ((3, 7), piece Pawn White);
          ]
      in
      assert_bool "not in check" (not (in_check pos Black));
      assert_equal [] (Moves.legal_moves pos);
      assert_equal Stalemate (status_of pos) );
  ]

(* ---------- insufficient material ---------- *)

let material_tests =
  [
    ( "K vs K" >:: fun _ ->
      let pos =
        pos_of
          [ ((5, 1), piece King White); ((5, 8), piece King Black) ]
      in
      assert_bool "insufficient" (insufficient_material pos) );
    ( "K+B vs K" >:: fun _ ->
      let pos =
        pos_of
          [
            ((5, 1), piece King White);
            ((3, 3), piece Bishop White);
            ((5, 8), piece King Black);
          ]
      in
      assert_bool "insufficient" (insufficient_material pos) );
    ( "K+Q vs K is sufficient" >:: fun _ ->
      let pos =
        pos_of
          [
            ((5, 1), piece King White);
            ((4, 4), piece Queen White);
            ((5, 8), piece King Black);
          ]
      in
      assert_bool "sufficient" (not (insufficient_material pos)) );
    ( "same color bishops" >:: fun _ ->
      let pos =
        pos_of
          [
            ((5, 1), piece King White);
            ((3, 3), piece Bishop White);
            (* 3+3 even *)
            ((5, 8), piece King Black);
            ((4, 4), piece Bishop Black);
            (* 4+4 even *)
          ]
      in
      assert_bool "insufficient" (insufficient_material pos) );
  ]

(* ---------- undo / draw / resign ---------- *)

let engine_meta_tests =
  [
    ( "undo one ply" >:: fun _ ->
      let g = play [ "e4"; "e5" ] in
      assert_equal White (turn g);
      let g = must_ok (undo g) in
      assert_equal Black (turn g);
      assert_equal
        (Some { kind = Pawn; color = White })
        (get (board g) (5, 4));
      assert_equal None (get (board g) (5, 5)) );
    ( "undo after single move" >:: fun _ ->
      let g = play [ "e4" ] in
      let g = must_ok (undo g) in
      assert_equal White (turn g);
      assert_equal
        (Some { kind = Pawn; color = White })
        (get (board g) (5, 2));
      assert_equal None (get (board g) (5, 4)) );
    ( "undo unavailable at start" >:: fun _ ->
      assert_equal (Error Undo_unavailable) (undo (create `Classical)) );
    ( "resign" >:: fun _ ->
      let g = resign (create `Classical) in
      assert_equal (Resigned White) (status g);
      assert_bool "over" (is_over g) );
    ( "draw agreement" >:: fun _ ->
      (* White offers, White moves (offer persists), Black offers → agreement. *)
      let g0 = create `Classical |> offer_draw in
      assert_equal (true, false) (draw_offers g0);
      let g1 = apply_str g0 "e4" in
      assert_equal (true, false) (draw_offers g1);
      let g = offer_draw g1 in
      assert_equal DrawAgreement (status g);
      assert_bool "over" (is_over g) );
  ]

(* ---------- path / jump ---------- *)

let path_tests =
  [
    ( "rook blocked" >:: fun _ ->
      let pos =
        pos_of
          [
            ((1, 1), piece Rook White);
            ((1, 2), piece Pawn White);
            ((5, 1), piece King White);
            ((5, 8), piece King Black);
          ]
      in
      let m = Normal { from = (1, 1); to_ = (1, 3); promotion = None } in
      assert_bool "blocked" (not (is_pseudo_legal pos m)) );
    ( "knight jumps" >:: fun _ ->
      let pos = Position.classical in
      let m = Normal { from = (2, 1); to_ = (3, 3); promotion = None } in
      assert_bool "Nf3 pseudo" (is_pseudo_legal pos m) );
  ]

(* ---------- FEN / move list ---------- *)

let start_fen =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

let fen_move_list_tests =
  [
    ( "classical to_fen" >:: fun _ ->
      assert_equal start_fen (to_fen (create `Classical)) );
    ( "fen round-trip start" >:: fun _ ->
      match Fen.of_fen start_fen with
      | Error e -> assert_failure (Fen.error_to_string e)
      | Ok (pos, seed) ->
          assert_equal None seed;
          assert_equal start_fen (Fen.to_fen pos) );
    ( "of_fen after e4" >:: fun _ ->
      let fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1" in
      let g = must_ok (of_fen fen) in
      assert_equal Black (turn g);
      assert_equal
        (Some { kind = Pawn; color = White })
        (get (board g) (5, 4));
      assert_equal fen (to_fen g) );
    ( "anarchy seed stored and in fen" >:: fun _ ->
      let g = create ~seed:42 `Anarchy in
      assert_equal (Some 42) (seed g);
      let fen = to_fen g in
      assert_bool "fen ends with seed"
        (Filename.check_suffix fen " 42"
        ||
        let parts = String.split_on_char ' ' fen in
        List.nth parts (List.length parts - 1) = "42");
      let g2 = must_ok (of_fen fen) in
      assert_equal (Some 42) (seed g2);
      assert_equal fen (to_fen g2);
      (* Same seed reproduces the same starting layout. *)
      let g3 = create ~seed:42 `Anarchy in
      assert_equal (to_fen g) (to_fen g3) );
    ( "move list scholars" >:: fun _ ->
      let g = play [ "e4"; "e5"; "Bc4"; "Nc6"; "Qh5"; "Nf6" ] in
      assert_equal "1. e4 e5  2. Bc4 Nc6  3. Qh5 Nf6" (move_list g) );
    ( "move list after undo" >:: fun _ ->
      let g = play [ "e4"; "e5"; "Nf3" ] in
      let g = must_ok (undo g) in
      assert_equal "1. e4 e5" (move_list g) );
    ( "bad fen rejected" >:: fun _ ->
      match of_fen "not a fen" with
      | Error (Fen _) -> ()
      | _ -> assert_failure "expected Fen error" );
  ]

let tests =
  "chess test suite"
  >::: classical_setup_tests @ notation_tests @ capture_tests
       @ en_passant_tests @ castling_tests @ promotion_tests @ check_tests
       @ material_tests @ engine_meta_tests @ path_tests
       @ fen_move_list_tests

let () = run_test_tt_main tests
