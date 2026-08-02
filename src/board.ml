open Piece

module Sq = struct
  type t = square

  let compare = Stdlib.compare
end

module M = Map.Make (Sq)

type t = piece M.t

let empty = M.empty

let on_board (x, y) = x >= 1 && x <= 8 && y >= 1 && y <= 8

let get board sq = M.find_opt sq board

let set board sq piece = M.add sq piece board

let remove board sq = M.remove sq board

let move board from to_ =
  match M.find_opt from board with
  | None -> raise Not_found
  | Some p -> M.add to_ p (M.remove from board)

let pieces_of board color =
  M.fold
    (fun sq p acc -> if p.color = color then (sq, p) :: acc else acc)
    board []

let all_pieces board = M.bindings board

let fold f board acc = M.fold f board acc

let of_list lst =
  List.fold_left (fun b (sq, p) -> M.add sq p b) M.empty lst
