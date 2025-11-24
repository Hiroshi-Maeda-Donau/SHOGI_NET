import shogi
import numpy as np

def sfen_to_array(sfen):
    board = shogi.Board(sfen)
    array = np.zeros((18, 9, 9), dtype=np.int8)

    for square in range(81):
        piece = board.piece_at(square)
        if piece is None:
            continue

        row = 8 - (square // 9)
        col = square % 9
        piece_type = piece.piece_type  # 1〜8 が基本

        if 1 <= piece_type <= 8:
            idx = piece_type - 1
            if piece.color == shogi.BLACK:
                array[idx, row, col] = 1
            else:
                array[idx + 9, row, col] = 1
        else:
            print(f"⚠️ 無効な駒種: piece_type={piece_type} at square={square}（無視されました）")

    return array

