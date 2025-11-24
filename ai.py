# ai.py
#from tensorflow.keras.models import load_model
from pathlib import Path
from tensorflow import keras

from utils.convert_move_to_label import move_to_label, label_to_move
from utils.sfen_to_array import sfen_to_array

import numpy as np
import shogi
import random

_MODEL = None
_CANDIDATES = [
    "models/shogi_policy_best.keras",
    "models/shogi_policy.keras",
    "models/shogi_model.h5",  # ← 旧形式を最後に
]

# モデルの読み込み（初回のみで済ませたい場合は工夫が必要）

#model = load_model("models/shogi_model.h5")
#model = load_model("models/shogi_policy_best.keras")

def get_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    for path in _CANDIDATES:
        p = Path(path)
        if p.exists():
            try:
                # Keras3 形式（.keras）
                _MODEL = keras.saving.load_model(p)
            except Exception:
                # 旧H5形式のフォールバック
                from tensorflow.keras.models import load_model as tf_load_model
                _MODEL = tf_load_model(p)
            return _MODEL
    raise FileNotFoundError("モデルが見つかりません（.keras か .h5 を models/ に置いてください）。")

def choose_best_move_learning(board):
    #import numpy as np

    sfen = board.sfen()

    x = sfen_to_array(sfen)
    x = np.transpose(x, (1, 2, 0))  # ←この1行が大事
    x = np.expand_dims(x, axis=0)

    predictions = model.predict(x)[0]  # shape: (13689,)
    legal_moves = list(board.legal_moves)

    best_move = None
    best_score = -np.inf

    for move in legal_moves:
        usi_move = move.usi()
        label = move_to_label(usi_move)
        if label != -1:
            score = predictions[label]
            if score > best_score:
                best_score = score
                best_move = move

    return best_move

def evaluate_move_simple(move, board):
    value_table = {
        shogi.PAWN: 1,
        shogi.LANCE: 2,
        shogi.KNIGHT: 3,
        shogi.SILVER: 4,
        shogi.GOLD: 5,
        shogi.BISHOP: 8,
        shogi.ROOK: 9,
        shogi.KING: 0,
    }

    score = 0

    # ① 駒得：移動先に駒があるかどうか
    if board.piece_at(move.to_square):
        captured_piece = board.piece_at(move.to_square).piece_type
        score += value_table.get(captured_piece, 0)

    board.push(move)

    # ② 王手をかける手
    if board.is_check():
        score += 5

    # ③ 自玉が王手を受ける手は減点（愚手）
    board.turn = not board.turn  # 相手の番にして
    if board.is_check():
        score -= 10
    board.turn = not board.turn

    board.pop()
    return score

def evaluate_move_minimax(move, board, depth=2):
    value_table = {
        shogi.PAWN: 1,
        shogi.LANCE: 2,
        shogi.KNIGHT: 3,
        shogi.SILVER: 4,
        shogi.GOLD: 5,
        shogi.BISHOP: 8,
        shogi.ROOK: 9,
        shogi.KING: 0,
    }

    def minimax(bd, current_depth, is_maximizing):
        if current_depth == 0 or bd.is_game_over():
            return 0

        legal_moves = list(bd.legal_moves)
        if not legal_moves:
            return 0

        if is_maximizing:
            best_score = -float('inf')
            for mv in legal_moves:
                bd.push(mv)
                score = 0
                if bd.piece_at(mv.to_square):
                    captured = bd.piece_at(mv.to_square).piece_type
                    score += value_table.get(captured, 0)
                score += minimax(bd, current_depth - 1, False)
                bd.pop()
                best_score = max(best_score, score)
            return best_score
        else:
            best_score = float('inf')
            for mv in legal_moves:
                bd.push(mv)
                score = minimax(bd, current_depth - 1, True)
                bd.pop()
                best_score = min(best_score, score)
            return best_score

    board.push(move)
    score = minimax(board, depth - 1, False)
    board.pop()
    return score


def minimax(board, depth, is_maximizing):

    if depth == 0 or board.is_game_over():
        return evaluate_board_simple(board), None

    best_move = None
    if is_maximizing:
        max_eval = float('-inf')
        for move in board.legal_moves:
            board.push(move)
            eval, _ = minimax(board, depth - 1, False)
            board.pop()
            if eval > max_eval:
                max_eval = eval
                best_move = move
        return max_eval, best_move
    else:
        min_eval = float('inf')
        for move in board.legal_moves:
            board.push(move)
            eval, _ = minimax(board, depth - 1, True)
            board.pop()
            if eval < min_eval:
                min_eval = eval
                best_move = move
        return min_eval, best_move


def choose_best_move_simple(board):
    legal_moves = list(board.legal_moves)
    if not legal_moves:
        return None
    best_move = max(legal_moves, key=lambda m: evaluate_move_simple(m, board))
    return best_move

def choose_best_move_minimax(board):
    legal_moves = list(board.legal_moves)
    if not legal_moves:
        return None
    best_move = max(legal_moves, key=lambda m: evaluate_move_minimax(m, board))
    return best_move 
    
def choose_ai_move(board, ai_type="simple", **kwargs):
    """
    ai_type は明示引数にするのが分かりやすい。
    既存呼び出し側が choose_ai_move(board, ai_type=ai_type) ならそのまま動きます。
    """
    # kwargs 側から渡された場合にも対応（冗長だが安全網）
    if "ai_type" in kwargs:
        ai_type = kwargs["ai_type"]

    print("🔺ai_type =", ai_type)

    if ai_type == "learning":
        try:
            return choose_best_move_learning(board)
        except FileNotFoundError:
            # モデルが無い時は簡易AIにフォールバック
            print("⚠️ 学習モデル未検出のため simple にフォールバックします")
            return choose_best_move_simple(board)
    elif ai_type == "minimax":
        return choose_best_move_minimax(board)
    else:
        return choose_best_move_simple(board)
