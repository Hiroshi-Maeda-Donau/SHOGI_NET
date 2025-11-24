# utils/snapshots.py
import os
import json
import time
import copy
from typing import Dict, Any, List, Optional

SNAPSHOT_DIR = "snapshots"
os.makedirs(SNAPSHOT_DIR, exist_ok=True)

def _snapshot_filename(main: str, sub: str) -> str:
    """
    main/sub ペアごとに 1 ファイルだけ持つ想定のファイル名。
    例: pvp_snapshot_Alice_vs_Bob.json
    """
    return f"pvp_snapshot_{main}_vs_{sub}.json"


def save_snapshot(
    key: tuple[str, str],
    match: Dict[str, Any],
    *,
    status_override: Optional[str] = None,
    resume_only: bool = False,
) -> str:
    """
    対局状態をスナップショットとして保存。
    - status_override を指定すると保存データの status を上書きします（例: "finished"）。
    - resume_only=True のとき、再開専用マーカーを付けます（一覧等でフィルタに使う）。
    戻り値: 保存ファイルのフルパス
    """
    main, sub = key
    data = copy.deepcopy(match)

    # JSONにそのまま書ける構造のみを前提（独自オブジェクトは事前に dict/list 化しておく）
    schema_version = 1
    now = int(time.time())

    data["schema_version"] = schema_version
    data["snapshot_ts"] = now
    data["resume_only"] = bool(resume_only)

    # status: match 側が持っていればそれを尊重。override 指定時は上書き。
    st = data.get("status", "ongoing")
    if status_override is not None:
        st = status_override
    data["status"] = st

    # 安全のため最低限のキーが無ければ補う
    data.setdefault("main", main)
    data.setdefault("sub", sub)
    data.setdefault("started", data.get("started", False))
    data.setdefault("first", data.get("first", "main"))
    data.setdefault("kifu", data.get("kifu", []))
    data.setdefault("captured", data.get("captured", {"main": [], "sub": []}))

    # ★ main/sub ペアごとに 1 ファイルだけ持つ
    fname = _snapshot_filename(main, sub)
    path = os.path.join(SNAPSHOT_DIR, fname)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return path

def list_snapshots(
    main: str,
    sub: str,
    *,
    resume_only: Optional[bool] = None,
    exclude_finished: bool = False,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    指定ペア(main, sub)のスナップショット一覧を返す（新しい順）。
    - resume_only: True/False でフィルタ。None なら無指定。
    - exclude_finished: True なら status=="finished" を除外（再開候補向け）。
    - limit: 最大件数を制限（None で制限なし）。
    """
    items: List[Dict[str, Any]] = []
    for name in os.listdir(SNAPSHOT_DIR):
        if not name.endswith(".json"):
            continue
        if f"_{main}_vs_{sub}.json" not in name:
            continue
        path = os.path.join(SNAPSHOT_DIR, name)
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            continue

        if exclude_finished and d.get("status") == "finished":
            continue
        if resume_only is True and not d.get("resume_only", False):
            continue
        if resume_only is False and d.get("resume_only", False):
            continue

        items.append({
            "file": name,
            "ts": d.get("snapshot_ts"),
            "status": d.get("status"),
            "resume_only": d.get("resume_only", False),
            "kifu_len": len(d.get("kifu", [])),
            "first": d.get("first"),
        })

    items.sort(key=lambda x: (x.get("ts") or 0), reverse=True)
    if limit is not None:
        items = items[:limit]
    return items

def load_snapshot(file_name: str) -> Dict[str, Any]:
    """
    指定ファイル名のスナップショットを読み込んで返す。
    """
    path = os.path.join(SNAPSHOT_DIR, file_name)
    with open(path, encoding="utf-8") as f:
        return json.load(f)
