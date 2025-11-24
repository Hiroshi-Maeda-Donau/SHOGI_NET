import shogi
import shogi.CSA

# 全てのUSI形式の指し手を生成
def generate_all_possible_usi_moves():
    usi_moves = []
    files = '123456789'
    ranks = 'abcdefghi'

    # 駒打ち（P*7f など）
    pieces = ['P', 'L', 'N', 'S', 'G', 'B', 'R']
    for p in pieces:
        for f in files:
            for r in ranks:
                usi_moves.append(f"{p}*{f}{r}")

    # 通常の移動と成り
    for from_f in files:
        for from_r in ranks:
            for to_f in files:
                for to_r in ranks:
                    usi_moves.append(f"{from_f}{from_r}{to_f}{to_r}")
                    usi_moves.append(f"{from_f}{from_r}{to_f}{to_r}+")
    
    return usi_moves

# ラベル変換用辞書
ALL_USI_MOVES = generate_all_possible_usi_moves()
USI_TO_LABEL = {move: idx for idx, move in enumerate(ALL_USI_MOVES)}
LABEL_TO_USI = {idx: move for move, idx in USI_TO_LABEL.items()}

def move_to_label(usi_move):
    return USI_TO_LABEL.get(usi_move, -1)  # 見つからなければ -1

def label_to_move(label):
    return LABEL_TO_USI.get(label, None)

