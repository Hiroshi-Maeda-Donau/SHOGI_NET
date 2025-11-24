# dataset.py
# learn/dataset.py
# -*- coding: utf-8 -*-
import json
import hashlib
from pathlib import Path
from typing import List, Tuple, Optional

import numpy as np

# プロジェクト内モジュール
from .encode import board_to_planes
from .sfen_action import usi_to_action_id
from .apply_usi import apply_usi
from .utils import initial_board_2d


# ==============================
# 互換ラッパ（戻り値の型ゆらぎを吸収）
# ==============================
def _take3(x):
    """
    (board, hands, side) に正規化して返す。
    - list/tuple: 先頭3つ
    - dict: 'board','hands','side'（sideは 'turn','side_to_move','turn_player' なども許容）
    """
    if isinstance(x, (list, tuple)):
        if len(x) >= 3:
            return x[0], x[1], x[2]
        raise ValueError(f"expected >=3 items, got len={len(x)} in {type(x)}")

    if isinstance(x, dict):
        b = x.get("board")
        h = x.get("hands")
        s = x.get("side", x.get("turn", x.get("side_to_move", x.get("turn_player"))))
        if b is not None and h is not None and s is not None:
            return b, h, s
        raise ValueError(f"dict result missing keys: has={list(x.keys())[:8]}")

    raise ValueError(f"unexpected result type: {type(x)}")


def _sfen_row_to_cells(row: str) -> list:
    """SFEN1段分をセル配列へ展開（数字は空マスの繰り返し）"""
    cells = []
    for ch in row:
        if ch.isdigit():
            cells.extend([""] * int(ch))
        elif ch == ".":
            cells.append("")
        else:
            cells.append(ch)
    return cells


def _normalize_board_2d(board) -> list:
    """
    board が str / list[str] / list[list[str]] / SFEN でも 9x9 の list[list[str]] にして返す。
    """
    # 既に 9x9 二次元配列
    if isinstance(board, list) and board and isinstance(board[0], list):
        if len(board) == 9 and all(isinstance(r, list) and len(r) == 9 for r in board):
            return board

    # "row/.../row" 形式
    if isinstance(board, str) and "/" in board:
        rows = board.split("/")
        norm = []
        for row in rows:
            cells = _sfen_row_to_cells(row.strip())
            if len(cells) < 9:
                cells += [""] * (9 - len(cells))
            if len(cells) > 9:
                cells = cells[:9]
            norm.append(cells)
        if len(norm) < 9:
            norm += [[""] * 9 for _ in range(9 - len(norm))]
        if len(norm) > 9:
            norm = norm[:9]
        return norm

    # list[str]（各段が文字列）
    if isinstance(board, list) and board and isinstance(board[0], str):
        norm = []
        for row in board:
            if "," in row or " " in row:
                cells = [c.strip() for c in row.replace(",", " ").split() if c.strip()]
            else:
                cells = list(row)
            if len(cells) < 9:
                cells += [""] * (9 - len(cells))
            if len(cells) > 9:
                cells = cells[:9]
            norm.append(cells)
        if len(norm) < 9:
            norm += [[""] * 9 for _ in range(9 - len(norm))]
        if len(norm) > 9:
            norm = norm[:9]
        return norm

    # list（長さ9で各要素がスカラ）の場合
    if isinstance(board, list) and len(board) == 9 and all(not isinstance(r, (list, dict)) for r in board):
        norm = []
        for r in board:
            s = str(r)
            cells = list(s)[:9]
            if len(cells) < 9:
                cells += [""] * (9 - len(cells))
            norm.append(cells)
        return norm

    # 不明→空盤
    return [[""] * 9 for _ in range(9)]


def _normalize_hands(h):
    """
    hands を {"sente": {...}, "gote": {...}} に統一。
    """
    def as_piece_dict(x):
        return x if isinstance(x, dict) else {}

    if isinstance(h, dict):
        s = h.get("sente", h.get("black", h.get("b", h.get("B"))))
        g = h.get("gote", h.get("white", h.get("w", h.get("W"))))
        return {"sente": as_piece_dict(s), "gote": as_piece_dict(g)}

    if isinstance(h, (list, tuple)) and len(h) == 2:
        return {"sente": as_piece_dict(h[0]), "gote": as_piece_dict(h[1])}

    return {"sente": {}, "gote": {}}


def _normalize_side(s):
    """
    side を "sente" / "gote" に統一。
    """
    if isinstance(s, str):
        ls = s.lower()
        if ls in ("sente", "black", "b"):
            return "sente"
        if ls in ("gote", "white", "w"):
            return "gote"
    if isinstance(s, (int, bool)):
        return "sente" if int(s) == 1 else "gote"
    return "sente"


def _unpack_initial_board():
    b, h, s = _take3(initial_board_2d())
    return _normalize_board_2d(b), _normalize_hands(h), _normalize_side(s)


def _apply_usi_compat(board, hands, side, usi):
    b = _normalize_board_2d(board)
    h = _normalize_hands(hands)
    s = _normalize_side(side)
    return _take3(apply_usi(b, h, s, usi))


# ==============================
# 指紋（fingerprint）
# ==============================
ALLOWED_KEYS = ("moves", "first", "result", "reason")


def make_fingerprint(kifu: dict) -> str:
    """
    棋譜から安定的なSHA-1指紋を作る（学習で使う最小集合のみ）。
    moves が無ければ kifu[].usi から抽出。
    """
    core = {}
    mv = kifu.get("moves")
    if not mv:
        karr = kifu.get("kifu")
        if isinstance(karr, list):
            mv = [m.get("usi") for m in karr if isinstance(m, dict) and m.get("usi")]
        else:
            mv = []
    core["moves"] = mv
    for k in ("first", "result", "reason"):
        if k in kifu and kifu[k] is not None:
            core[k] = kifu[k]
    norm = json.dumps(core, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()


def _load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _save_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


# ==============================
# 1ゲームのエンコード
# ==============================
def _encode_single_game(kifu_json: dict):
    board, hands, side = _unpack_initial_board()
    X, y = [], []

    moves = kifu_json.get("moves")
    if not moves:
        karr = kifu_json.get("kifu")
        if isinstance(karr, list):
            moves = [m.get("usi") for m in karr if isinstance(m, dict) and m.get("usi")]
        else:
            moves = []

    for usi in moves:
        try:
            aid = usi_to_action_id(usi)
        except Exception:
            continue
        if aid is None:
            continue

        X.append(board_to_planes(_normalize_board_2d(board), _normalize_hands(hands), _normalize_side(side)))
        y.append(aid)

        board, hands, side = _apply_usi_compat(board, hands, side, usi)

    return np.asarray(X, np.float32), np.asarray(y, np.int32)


# ==============================
# registry（list[str] の集合）
# ==============================
def _load_registry_set(registry_path: Optional[str]) -> set:
    if not registry_path:
        return set()
    p = Path(registry_path)
    if not p.exists():
        return set()
    try:
        arr = json.loads(p.read_text(encoding="utf-8"))
        return set(x for x in arr if isinstance(x, str))
    except Exception:
        return set()


def _save_registry(registry_path: str, s: set):
    p = Path(registry_path)
    _save_json(p, sorted(s))


# ==============================
# フォルダ読み込み
# ==============================
def _is_finished_record(data: dict) -> bool:
    """
    終局判定を winner / reason まで緩和。
    """
    if bool(data.get("finished")):
        return True
    if data.get("result") is not None:
        return True
    if data.get("winner") is not None:
        return True
    rs = str(data.get("reason") or "").lower()
    if rs in {"resign", "timeout", "illegal", "mate", "sennichite", "perpetual_check", "draw"}:
        return True
    return False


def load_folder_as_dataset(
    folder: str,
    finished_only: bool = False,
    registry_path: Optional[str] = None,
    only_unfingerprinted: bool = True,
    collect_mark_list: bool = False,
):
    """
    指定フォルダ内の *.json を走査して (X,y) を構築。
    - finished_only=True: 終局フラグのある棋譜のみ
    - registry_path: 既学習の fingerprint をスキップ（増分）
    - collect_mark_list=True: 'fingerprint' を付与すべき (path, fp) を返す
    """
    folder_p = Path(folder)
    if not folder_p.exists():
        raise FileNotFoundError(f"folder not found: {folder}")

    regset = _load_registry_set(registry_path) if registry_path else set()

    Xs: List[np.ndarray] = []
    Ys: List[np.ndarray] = []
    kept = skipped_unfinished = skipped_seen = 0
    mark_list: List[Tuple[str, str]] = []

    for p in sorted(folder_p.glob("*.json")):
        data = _load_json(p)
        if not isinstance(data, dict):
            continue

        # 1) 終局チェック（緩和版）
        if finished_only:
            finished_flag = _is_finished_record(data)
            if not finished_flag:
                skipped_unfinished += 1
                continue

        # 2) 指紋
        fp = data.get("fingerprint")
        if not isinstance(fp, str) or len(fp) < 32:
            fp = make_fingerprint(data)
            if collect_mark_list:
                mark_list.append((str(p), fp))

        # 3) 増分スキップ
        if only_unfingerprinted and registry_path and fp in regset:
            skipped_seen += 1
            continue

        # 4) encode
        X, Y = _encode_single_game(data)
        if X.size == 0 or Y.size == 0:
            continue
        Xs.append(X)
        Ys.append(Y)
        kept += 1

    if not Xs:
        print(f"📝 kept=0, skipped_unfinished={skipped_unfinished}, skipped_seen={skipped_seen}")
        # フォールバック：終局のみで0件なら未終局も許可して再読込
        if finished_only and skipped_unfinished > 0:
            print("↩️ 終局のみでは0件だったため、未終局も許可して再読み込みします")
            return load_folder_as_dataset(
                folder=folder,
                finished_only=False,
                registry_path=registry_path,
                only_unfingerprinted=only_unfingerprinted,
                collect_mark_list=collect_mark_list,
            )
        raise RuntimeError(f"データが見つかりませんでした: {folder}")

    print(f"🗂️ load [{folder}]: kept={kept} skipped_unfinished={skipped_unfinished} skipped_seen={skipped_seen}")

    Xc = np.concatenate(Xs, axis=0)
    Yc = np.concatenate(Ys, axis=0)
    return (Xc, Yc, mark_list) if collect_mark_list else (Xc, Yc)


# ==============================
# 2フォルダ読み込み（通常 + 反転）
# ==============================
def load_two_folders(
    folder_a: str,
    folder_b: Optional[str] = None,
    finished_only: bool = False,
    registry_a: Optional[str] = None,
    registry_b: Optional[str] = None,
    collect_mark_list: bool = True,
    only_unfingerprinted: bool = True,
):
    Xa, Ya, mark_a = load_folder_as_dataset(
        folder_a,
        finished_only=finished_only,
        registry_path=registry_a,
        only_unfingerprinted=only_unfingerprinted,
        collect_mark_list=True,
    )

    Xb = Yb = None
    mark_b: List[Tuple[str, str]] = []

    if folder_b and Path(folder_b).exists():
        Xb, Yb, mark_b = load_folder_as_dataset(
            folder_b,
            finished_only=finished_only,
            registry_path=registry_b or registry_a,
            only_unfingerprinted=only_unfingerprinted,
            collect_mark_list=True,
        )

    if Xb is not None:
        X = np.concatenate([Xa, Xb], axis=0)
        Y = np.concatenate([Ya, Yb], axis=0)
        marks = mark_a + mark_b
    else:
        X, Y, marks = Xa, Ya, mark_a

    return X, Y, marks


# ==============================
# 指紋の書き戻し／消去
# ==============================
def mark_fingerprints(mark_list: List[Tuple[str, str]]):
    """
    mark_list: [(path, fp), ...]
    実際に学習に使ったファイル（通常＋反転）にのみ 'fingerprint' を付与。
    """
    for path, fp in mark_list:
        try:
            p = Path(path)
            data = _load_json(p) or {}
            if data.get("fingerprint") != fp:
                data["fingerprint"] = fp
                _save_json(p, data)
        except Exception as e:
            print(f"⚠️ mark_fingerprints failed: {path} ({e})")


def wipe_fingerprints(folders: List[str]):
    """
    指定フォルダ配下の *.json から 'fingerprint' を削除（存在すれば）。
    例: wipe_fingerprints(['kifu/pvp', 'kifu/pvp_flip'])
    """
    for folder in folders:
        pdir = Path(folder)
        if not pdir.exists():
            continue
        print(f"🧹 wiping fingerprints in: {folder}")
        for p in sorted(pdir.glob("*.json")):
            data = _load_json(p)
            if not isinstance(data, dict):
                continue
            if "fingerprint" in data:
                data.pop("fingerprint", None)
                _save_json(p, data)
