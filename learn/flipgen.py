# learn/flipgen.py
from __future__ import annotations
from pathlib import Path
import json
from typing import Tuple, Dict, Any

A2I = dict(zip("abcdefghi", "ihgfedcba"))  # 段の反転（a↔i, b↔h, ...）

def flip_sq(sq: str) -> str:
    """USIのマス表記 '7g' → 反転 '3c'（180度回転）"""
    if not isinstance(sq, str) or len(sq) != 2:
        return sq
    f, r = sq[0], sq[1].lower()
    if f.isdigit() and r in A2I:
        return f"{10 - int(f)}{A2I[r]}"
    return sq

def flip_usi(usi: str) -> str:
    """USI文字列を反転。例: '7g7f'→'3c3d', 'P*7f'→'P*3d', '7f7e+'→'3d3e+'"""
    if not isinstance(usi, str):
        return usi
    if "*" in usi:  # ドロップ
        piece, sq = usi.split("*", 1)
        return f"{piece}*{flip_sq(sq)}"
    # 通常 or 成り
    prom = usi.endswith("+")
    core = usi[:-1] if prom else usi
    if len(core) != 4:
        return usi  # 想定外はそのまま
    f1, r1, f2, r2 = core[0], core[1], core[2], core[3]
    sq1 = flip_sq(f1 + r1)
    sq2 = flip_sq(f2 + r2)
    return f"{sq1}{sq2}{'+' if prom else ''}"

def _is_finished(data: Dict[str, Any]) -> bool:
    """柔らかい終局判定（dataset.py と同等ロジックに合わせる）"""
    if data.get("finished"):
        return True
    if data.get("result") is not None:
        return True
    if data.get("winner") is not None:
        return True
    rs = str(data.get("reason") or "").lower()
    return rs in {"resign","timeout","illegal","mate","sennichite","perpetual_check","draw"}

META_COPY = ["finished", "result", "reason", "first", "winner"]

def _swap_main_sub(val):
    if isinstance(val, str):
        v = val.lower()
        if v == "main": return "sub"
        if v == "sub":  return "main"
    return val

def _build_flipped(src: Dict[str, Any]) -> Dict[str, Any]:
    """元棋譜から反転棋譜を生成（指紋はコピーしない・moves/kifuは反転で統一）"""
    dst: Dict[str, Any] = {}

    # 1) メタコピー（fingerprint はコピーしない）
    for k in META_COPY:
        if k in src and src[k] is not None:
            dst[k] = src[k]

    # 2) 先手/勝者の入替（first, winner は main/sub を入れ替え）
    if "first" in dst:
        dst["first"] = _swap_main_sub(dst["first"])
    if "winner" in dst:
        dst["winner"] = _swap_main_sub(dst["winner"])

    # 3) 反転フラグ
    dst["flipped"] = True

    # 4) moves と kifu[].usi を反転で統一
    #    - まず moves を基準に
    moves = src.get("moves")
    if not isinstance(moves, list) or not all(isinstance(m, str) for m in moves):
        # fallback: kifu[].usi から作る
        karr = src.get("kifu")
        if isinstance(karr, list):
            moves = [e.get("usi") for e in karr if isinstance(e, dict) and e.get("usi")]
        else:
            moves = []
    flipped_moves = [flip_usi(m) for m in moves]
    dst["moves"] = flipped_moves

    # kifu は最小構成に再構築（from/to 等の整合崩れを避けるため）
    karr = []
    turn_flag = dst.get("first") or _swap_main_sub(src.get("first") or "main")  # 念のため
    cur = turn_flag
    for u in flipped_moves:
        karr.append({"type":"move", "usi": u, "by": cur})
        cur = _swap_main_sub(cur)
    dst["kifu"] = karr

    # 5) プレイヤ名など情報は元を踏襲（main/sub の名前など）
    for k in ["version","mode","timestamp","main","sub","players","date"]:
        if k in src and k not in dst:
            dst[k] = src[k]

    return dst

def generate_flips(
    src_dir: str = "kifu/pvp",
    dst_dir: str = "kifu/pvp_flip",
    finished_only: bool = True,
    overwrite: bool = False,
) -> Tuple[int,int,int]:
    """
    src_dir の *.json を反転して dst_dir へ出力。
    - finished_only: True なら未終局はスキップ
    - overwrite: True なら既存を上書き
    return: (kept, skipped_unfinished, already)
    """
    srcp = Path(src_dir); dstp = Path(dst_dir)
    dstp.mkdir(parents=True, exist_ok=True)
    kept = skipped_unfinished = already = 0

    for sp in sorted(srcp.glob("*.json")):
        try:
            obj = json.loads(sp.read_text(encoding="utf-8"))
        except Exception:
            continue
        if finished_only and not _is_finished(obj):
            skipped_unfinished += 1
            print(f"  ↳ 未終局のためスキップ  {sp.name}")
            continue

        out = dstp / sp.name
        if out.exists() and not overwrite:
            already += 1
            print(f"  ↳ 既存のためスキップ  {sp.name}")
            continue

        flip = _build_flipped(obj)
        # 指紋はコピーしない（ポリシー）
        if "fingerprint" in flip:
            flip.pop("fingerprint", None)
        out.write_text(json.dumps(flip, ensure_ascii=False, indent=2), encoding="utf-8")
        kept += 1
        print(f"  ✅ 生成 {sp.name}")

    print(f"✅ 完了 kept={kept} skipped={skipped_unfinished} already={already}")
    return kept, skipped_unfinished, already

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Generate flipped shogi kifu files.")
    ap.add_argument("--src", default="kifu/pvp")
    ap.add_argument("--dst", default="kifu/pvp_flip")
    ap.add_argument("--finished-only", action="store_true", default=False)
    ap.add_argument("--overwrite", action="store_true", default=False)
    args = ap.parse_args()
    generate_flips(args.src, args.dst, finished_only=args.finished_only, overwrite=args.overwrite)

