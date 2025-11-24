# learn/infer.py
from __future__ import annotations
from pathlib import Path
from typing import Optional, Sequence

import numpy as np
from tensorflow import keras

# ★ ここを修正（utils ではなく、learn パッケージ内のモジュールから）
from .encode import board_to_planes
from .sfen_action import action_id_to_usi
# pick_from_logits はこのファイル内で定義（下に実装）

CANDIDATES = [
    "models/shogi_policy_best.keras",
    "models/shogi_policy.keras",
    "models/shogi_policy.h5",
    "models/shogi_model.h5",
]

def _load_any_model(path: str):
    try:
        return keras.saving.load_model(path)
    except Exception:
        from tensorflow.keras.models import load_model as tf_load_model
        return tf_load_model(path)

# infer.py 内に追加（utils に依存しない実装）
def pick_from_logits(logits: np.ndarray,
                     legal_action_ids: list[int] | np.ndarray,
                     temperature: float = 1.0,
                     topk: int | None = None) -> tuple[int, float]:
    """
    logits: (A,)  行動全体のロジット
    legal_action_ids: 合法手IDのリスト
    temperature: 0 or neg なら argmax、>0 なら softmax サンプリング
    topk: 上位Kに制限したいときに指定（None ならすべての合法手から）
    return: (選んだ action_id, その選択確率)
    """
    legal = np.asarray(legal_action_ids, dtype=int)
    if legal.size == 0:
        # 合法手が無い場合は全域からargmax（理論上ほぼ無いはず）
        aid = int(np.argmax(logits))
        return aid, 1.0

    # 合法手以外は強制的に無効化
    masked = np.full_like(logits, -1e9, dtype=np.float32)
    masked[legal] = logits[legal]

    # top-k 制限（任意）
    if topk and topk > 0 and legal.size > topk:
        legal_top = legal[np.argpartition(masked[legal], -topk)[-topk:]]
    else:
        legal_top = legal

    # 温度 0 なら argmax
    if temperature is None or temperature <= 0:
        sub = masked[legal_top]
        idx = int(legal_top[np.argmax(sub)])
        return idx, 1.0

    # softmax サンプリング
    sub = masked[legal_top] / float(temperature)
    sub = sub - np.max(sub)  # 数値安定化
    probs = np.exp(sub)
    probs_sum = probs.sum()
    if probs_sum <= 0 or not np.isfinite(probs_sum):
        # 全て -inf など（ありえないが保険）：argmaxで返す
        idx = int(legal_top[np.argmax(sub)])
        return idx, 1.0
    probs = probs / probs_sum
    choice = int(np.random.choice(len(legal_top), p=probs))
    aid = int(legal_top[choice])
    return aid, float(probs[choice])


class PolicyAgent:
    def __init__(self, model_path: str | None = None, lazy: bool = True):
        self.model_path = model_path
        self.model = None
        self.lazy = lazy
        if not self.lazy:
            self._ensure_model()

    def _resolve_model_path(self):
        if self.model_path and Path(self.model_path).exists():
            return self.model_path
        for p in CANDIDATES:
            if Path(p).exists():
                return p
        return None

    def _ensure_model(self):
        if self.model is not None:
            return
        path = self._resolve_model_path()
        if not path:
            if self.lazy:
                return
            raise FileNotFoundError(f"No policy model found. Tried: {CANDIDATES}")
        print(f"🧠 Loading policy model: {path}")
        self.model = _load_any_model(path)

    # ←★ここがあなたの「必要なら追加」部分
    def select_move(self, board_2d, hands, side_to_move, legal_action_ids,
                    temperature=1.0, topk=None):
        self._ensure_model()
        if self.model is None:
            raise FileNotFoundError(f"No policy model found. Tried: {CANDIDATES}")

        x = board_to_planes(board_2d, hands, side_to_move)
        x = x[np.newaxis, ...]
        logits = self.model.predict(x, verbose=0)[0]
        aid, prob = pick_from_logits(logits, legal_action_ids,
                                     temperature=temperature, topk=topk)
        usi = action_id_to_usi(aid)
        return usi, float(prob)
