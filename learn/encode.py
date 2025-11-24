# /learn/encode.py
import numpy as np
from .constants import PIECES, PIECE2IDX, DROP_ORDER, MAX_HAND

def board_to_planes(board_2d, hands, side_to_move):
    """
    board_2d: 9x9 の文字（"", "P","p","+B","+b" など）
              大文字=先手(S), 小文字=後手(G)、"+"は成り
    hands: {"sente":{P:cnt,...}, "gote":{P:cnt,...}}
    side_to_move: "sente" or "gote"
    """
    H, W = 9, 9
    planes = np.zeros((H, W, 28 + 14 + 1), dtype=np.float32)

    # 盤面 28面
    for r in range(9):
        for c in range(9):
            code = board_2d[r][c]
            if not code: 
                continue
            is_gote = (code[0].islower() or (len(code) >= 2 and code[-1].islower()))
            up = code.upper()  # "+P" などに正規化
            idx = PIECE2IDX[up]
            side_offset = 14 if is_gote else 0
            planes[r, c, side_offset + idx] = 1.0

    # 手駒 14面（全セル同値）
    def fill_hand(side, base_ch):
        side_dict = hands.get(side, {})
        for i, p in enumerate(DROP_ORDER):
            cnt = float(side_dict.get(p, 0))
            v = cnt / MAX_HAND[p]
            planes[:, :, base_ch + i] = v

    fill_hand("sente", 28)  # 28..34
    fill_hand("gote",  35)  # 35..41

    # 手番 1面
    planes[:, :, 42] = 1.0 if side_to_move == "sente" else 0.0
    return planes  # (9,9,43)

