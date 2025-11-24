
from flask import Flask, request, jsonify, render_template, current_app,send_file, session
import shogi
import os
import json
import random
import threading, time, os, json, re
from datetime import datetime  
#from ai import choose_ai_move

from pathlib import Path

from utils.snapshots import save_snapshot, list_snapshots, load_snapshot

from learn.infer import PolicyAgent
from learn.sfen_action import usi_to_action_id
from learn.flipgen import generate_flips

# ==== 学習ジョブの状態 ====
from threading import Thread
from collections import deque
import subprocess, os, time, sys

app = Flask(__name__)

SQUARES = shogi.SQUARE_NAMES  # index -> '7f' 等

BASE_DIR = Path(__file__).resolve().parent
KIFU_ROOT = BASE_DIR / "kifu"    
KIFU_LOG_PATH = "saved_games/kifu_log.json"
# ==== 管理者ID ====
ALLOWED_TRAIN_IDS = {"shogi_master"}  # 必要なら追加: {"shogi_master", "admin"}

train_state = {
    "running": False,
    "params": None,
    "start_ts": None,
    "end_ts": None,
    "progress": 0.0,               # 0.0..1.0
    "log": deque(maxlen=2000),     # 直近ログ
    "rc": None                      # return code
}

def _append_log(line):
    ts = time.strftime("%H:%M:%S")
    train_state["log"].append(f"[{ts}] {line.rstrip()}")

def _run_training(params):
    try:
        train_state.update({
            "running": True, "params": params, "start_ts": time.time(),
            "end_ts": None, "progress": 0.0, "rc": None
        })
        folder = params.get("folder", "kifu/pvp")
        extra_folder = params.get("extra_folder", "kifu/pvp_flip")  # ★
        epochs = str(params.get("epochs", 3))
        batch  = str(params.get("batch", 64))
        full_reset = bool(params.get("full_reset", False))
        wipe_fps   = bool(params.get("wipe_fingerprints", True))

        if full_reset:
            _append_log("♻️ full reset requested")
            # 1) モデル全消去
            for p in ["models/shogi_policy.keras",
                      "models/shogi_policy_best.keras",
                      "models/shogi_policy.h5"]:
                _rm_file(p)
            # 2) レジストリ全消去
            _clear_registry(params.get("registry"))
            _clear_registry(params.get("extra_registry"))
            # 3) 棋譜の fingerprint 全消去（オプションでON）
            if wipe_fps:
                _wipe_fingerprints_in(folder)
                if extra_folder and os.path.isdir(extra_folder):
                    _wipe_fingerprints_in(extra_folder)

        # ---- 以降は従来どおり学習ジョブ起動 ----
        cmd = [
            sys.executable, "-m", "learn.train",
            "--folder", folder,
            "--epochs", epochs,
            "--batch", batch,
            "--registry", params["registry"],
            "--finished-only"  # ←未完了棋譜を除外（従来どおり）
        ]
        if extra_folder:
            cmd += ["--extra-folder", extra_folder]
        if params.get("extra_registry"):
            cmd += ["--extra-registry", params["extra_registry"]]

        _append_log(f"🚀 launch: {' '.join(cmd)}")
    
        # サブプロセス起動
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, bufsize=1)

        # ログ読み込み & 簡易進捗（"Epoch i/n" っぽい行を拾う）
        for line in proc.stdout:
            _append_log(line)
            # 進捗パース
            if "Epoch " in line:
                # 例: "Epoch 2/3"
                try:
                    #part = line.strip().split()[1]  # "2/3"
                    # kerasの出力は "Epoch 2/3" or "[..] Epoch 2/3"
                    toks = [t for t in line.strip().split() if "/" in t]
                    part = toks[0]  # "2/3"
                    i, n = part.split("/")
                    i, n = int(i), int(n)
                    train_state["progress"] = max(train_state["progress"], min(1.0, i / float(n)))
                except Exception:
                    pass

        rc = proc.wait()
        train_state["rc"] = rc
        _append_log(f"✅ finished (rc={rc})")
    except Exception as e:
        _append_log(f"💥 trainer exception: {e}")
        train_state["rc"] = -1
    finally:
        train_state["running"] = False
        train_state["end_ts"] = time.time()

def _require_trainer(player_id):
    if player_id not in game_states:
        return False, ("未ログインまたはセッション切れです", 401)
    if player_id not in ALLOWED_TRAIN_IDS:
        return False, ("権限がありません（学習は管理者専用）", 403)
    return True, None

# --- 反転処理の状態を保持（簡易キュー） ---
_flip_jobs = {}  # token -> {"lines": [str...], "done": bool}
#_allowed_train_ids = {"shogi_master"}  # 必要に応じて統一
_allowed_train_ids = "shogi_master"  # 必要に応じて統一

def _log(job, msg):
    job["lines"].append(msg)

def _rank_flip(sq: str) -> str:
    # "1a".."9i" を左右上下反転（完全反転）：ファイル=10-x, 段=a..i -> i..a
    m = re.fullmatch(r"([1-9])([a-i])", sq)
    if not m:
        return sq
    file = int(m.group(1))
    rank = m.group(2)
    file2 = 10 - file
    rank2 = chr(ord('a') + (ord('i') - ord(rank)))
    return f"{file2}{rank2}"

def _flip_usi(usi: str) -> str:
    # 例: "7g7f", "P*5e", "2b2a+", "+? は末尾成り"
    drop = "*" in usi
    promote = usi.endswith("+")
    core = usi[:-1] if promote else usi
    if drop:
        piece, dst = core.split("*")
        return f"{piece}*{_rank_flip(dst)}"
    else:
        src, dst = core[:2], core[2:4]
        flipped = f"{_rank_flip(src)}{_rank_flip(dst)}"
        return flipped + ("+" if promote else "")

def _flip_game_obj(obj: dict) -> dict:
    """棋譜JSON（オリジナル）→ 反転JSON を返す。"""
    out = dict(obj)  # 浅いコピー
    # moves か kifu[] を正規化して反転
    moves = obj.get("moves")
    if not moves:
        kifu = obj.get("kifu") or []
        moves = [m.get("usi") for m in kifu if m.get("usi")]
    moves = [str(m).strip() for m in (moves or []) if m]

    # 先手/後手・勝者などは入れ替え
    first = (obj.get("first") or "").lower()
    swap = {
        "sente":"gote", "gote":"sente",
        "player":"ai", "ai":"player",
        "you":"ai", "main":"sub", "sub":"main"
    }
    def _swap(s):
        return swap.get(str(s).lower(), s)

    out["first"]  = _swap(first)
    if "winner" in obj: out["winner"] = _swap(obj["winner"])
    if "result" in obj:
        # 勝敗表現が YOU/AI などでも swap されるように（必要なら）
        out["result"] = obj["result"]  # そのままでも可（win/loseなら中立）

    # 反転手の列挙
    flipped_moves = [_flip_usi(u) for u in moves]

    # 保存の統一：moves 配列に寄せる（kifu も残すなら out["kifu"] 再構築でもOK）
    out["moves"] = flipped_moves

    # メタ
    out["flipped"] = True
    out.pop("fingerprint", None)  # ← ご要望どおり、反転後は指紋を消す
    return out

def _is_finished_game(obj: dict) -> bool:
    # dataset.py の緩め判定と揃えておくと吉
    for k in ("ended","finished","game_over"):
        v = obj.get(k)
        if isinstance(v, bool) and v: return True
        if isinstance(v, str) and v.lower() in ("true","1","yes"): return True
    if obj.get("result") in ("win","lose","draw"): return True
    if obj.get("winner") in ("sente","gote","YOU","AI","main","sub"): return True
    if obj.get("reason") in ("checkmate","mate","resign","time","sennichite","jishogi"): return True
    return False

def _worker_flip(token, src, dst, finished_only, overwrite):
    lines = _flip_jobs[token]["lines"]
    def log(s): lines.append(s); print(s)

    try:
        log(f"🌀 反転生成開始: src={src}, dst={dst}, finished_only={finished_only}, overwrite={overwrite}")
        kept, skipped, already = generate_flips(
            src_dir=src,
            dst_dir=dst,
            finished_only=finished_only,
            overwrite=overwrite
        )
        log(f"✅ 完了 kept={kept} skipped_unfinished={skipped} already={already}")
    except Exception as e:
        log(f"❌ エラー: {e}")
    finally:
        _flip_jobs[token]["done"] = True

# ==== 追加: ヘルパー群 ====
def _rm_file(path: str):
    try:
        if path and os.path.exists(path):
            os.remove(path)
            _append_log(f"🧹 removed {path}")
    except Exception as e:
        _append_log(f"⚠️ remove failed {path}: {e}")

def _clear_registry(path: str):
    _rm_file(path)

def _wipe_fingerprints_in(folder: str):
    if not folder or not os.path.isdir(folder):
        return
    wiped = 0
    for fn in os.listdir(folder):
        if not fn.endswith(".json"):
            continue
        p = os.path.join(folder, fn)
        try:
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            if "fingerprint" in data:
                data.pop("fingerprint")
                with open(p, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                wiped += 1
        except Exception as e:
            _append_log(f"⚠️ fingerprint wipe failed {p}: {e}")
    _append_log(f"🧼 {folder}: wiped {wiped} fingerprints")

@app.post("/api/flip/start")
def api_flip_start():
    data = request.get_json() or {}
    player_id = data.get("player_id")
    print("_allowed_train_ids=",_allowed_train_ids)
    if player_id not in _allowed_train_ids:
        return jsonify({"error":"権限がありません"}), 403

    src = data.get("src") or "kifu/pvp"
    dst = data.get("dst") or "kifu/pvp_flip"
    finished_only = bool(data.get("finished_only", True))
    overwrite = bool(data.get("overwrite", False))

    token = f"flip-{int(time.time()*1000)}"
    _flip_jobs[token] = {"lines": [], "done": False}
    th = threading.Thread(target=_worker_flip, args=(token, src, dst, finished_only, overwrite), daemon=True)
    th.start()
    return jsonify({"token": token})

@app.get("/api/flip/status")
def api_flip_status():
    token = request.args.get("token")
    job = _flip_jobs.get(token)
    if not job:
        return jsonify({"error":"unknown token"}), 404
    return jsonify({"done": job["done"], "lines": job["lines"][-200:]})

# ==== API: 学習開始 ====
@app.post("/api/train/start")
def api_train_start():
    data = request.get_json() or {}
    player_id = data.get("player_id")
    ok, err = _require_trainer(player_id)
    
    if not ok:  # 権限チェック
        msg, code = err
        return jsonify({"error": msg}), code

    #if train_state["running"]:
        #return jsonify({"error": "すでに学習実行中です"}), 409
    if train_state["running"]:
        return jsonify({"error": "すでに学習実行中です"}), 409

    params = {
        "which": data.get("which", "policy"),
        "folder": data.get("folder", "kifu/pvp"),
        "extra_folder": data.get("extra_folder", "kifu/pvp_flip"),  # ★追加（任意）
        "epochs": int(data.get("epochs", 3)),
        "batch": int(data.get("batch", 64)),
        "full_reset": bool(data.get("full_reset", False)),
        "wipe_fingerprints": bool(data.get("wipe_fingerprints", True)),  # ★追加
        "registry": data.get("registry", "kifu/registry/main.json"),
        "extra_registry": data.get("extra_registry", "kifu/registry/flip.json"),
    }

    t = Thread(target=_run_training, args=(params,), daemon=True)
    t.start()
    return jsonify({"status": "started", "params": params})

# ==== API: ステータス ====
@app.get("/api/train/status")
def api_train_status():
    return jsonify({
        "running": train_state["running"],
        "progress": train_state["progress"],
        "params": train_state["params"],
        "rc": train_state["rc"],
        "start_ts": train_state["start_ts"],
        "end_ts": train_state["end_ts"],
    })

# ==== API: ログ ====
@app.get("/api/train/logs")
def api_train_logs():
    # 最新 200 行などを返す
    n = int(request.args.get("n", 200))
    logs = list(train_state["log"])[-n:]
    return jsonify({"lines": logs})

# ==== API: 停止（オプション） ====
@app.post("/api/train/stop")
def api_train_stop():
    # 簡易MVP: サブプロセス停止は次回対応（安全にkillするには管理が必要）
    return jsonify({"error": "stop 未対応（次版で実装）"}), 501

@app.get("/train")
def train_page():
    return render_template("admin_train.html")  # 上で作ったテンプレ

# グローバル変数（すでにあれば追記不要）
logged_in: set[str] = set()
waiting_sub_ids: set[str] = set()

match_requests = {}      # { sub_id: {"from": main_id, "first": "main" or "sub"} }

# --- 駒の表示変換 ---
KANJI_TO_USI = {
    "歩": "P", "香": "L", "桂": "N", "銀": "S", "金": "G",
    "角": "B", "飛": "R", "玉": "K",
    "と": "+P", "杏": "+L", "圭": "+N", "全": "+S", "馬": "+B", "竜": "+R"
}

USI_TO_SHOGI_CONST = {
    "P": shogi.PAWN,
    "L": shogi.LANCE,
    "N": shogi.KNIGHT,
    "S": shogi.SILVER,
    "G": shogi.GOLD,
    "B": shogi.BISHOP,
    "R": shogi.ROOK,
    "K": shogi.KING,
    "+P": shogi.PROM_PAWN,
    "+L": shogi.PROM_LANCE,
    "+N": shogi.PROM_KNIGHT,
    "+S": shogi.PROM_SILVER,
    "+B": shogi.PROM_BISHOP,  # ← 修正
    "+R": shogi.PROM_ROOK     # ← 修正
}

app.secret_key = "shogi-game"  # 何でもよい（乱数やGUID推奨）


# Flaskアプリのグローバル変数として定義（AI対局用）
game_states = {}

# サーバー内のグローバル辞書（対人対局用）
match_states = {}  # key: (main_id, sub_id), value: dict with match info

# 追加：ログイン中ユーザーのレジストリ
logged_in = set()   # まずはシンプルにセットでOK


# match_accepted = {}  # 例: {("mainID", "subID"): {"first": "main"}}

board = None
    
# ログイン中のIDを記録するセット
active_ids = set()

board = shogi.Board() 
captured_by_player = []
captured_by_ai = []

KANJI2CODE = {
    # 生駒
    "歩": "P", "香": "L", "桂": "N", "銀": "S", "金": "G", "角": "B", "飛": "R",
    "玉": "K", "王": "K",
    # 成り駒（あなたのUI表記に合わせて）
    "と": "+P", "杏": "+L", "圭": "+N", "全": "+S", "馬": "+B",
    "竜": "+R", "龍": "+R",
    # たまに全角空白などが来ても空にする保険
    "": "",
}

def normalize_board_for_policy(raw9):
    """board_to_matrix() の 9x9（'*香' 等）→ policy 用 9x9（'L' 等）に正規化"""
    norm = []
    for row in raw9:
        out = []
        for cell in row:
            s = cell or ""
            if isinstance(s, str) and s.startswith("*"):
                s = s[1:]  # 後手印の '*' を除去
            # 漢字→英字コード
            out.append(KANJI2CODE.get(s, s))  # 未知ならそのまま（デバッグ検出用）
        norm.append(out)
    return norm

# 日本語駒変換マップ
piece_name_mapping = {
    'P': '歩', 'L': '香', 'N': '桂', 'S': '銀',
    'G': '金', 'K': '玉', 'R': '飛', 'B': '角',
    '+P': 'と', '+L': '杏', '+N': '圭', '+S': '全',
    '+R': '竜', '+B': '馬'
}

# 駒の種類からshogi定数へのマッピング（打ち込み用）
piece_map = {
    "歩": shogi.PAWN,
    "香": shogi.LANCE,
    "桂": shogi.KNIGHT,
    "銀": shogi.SILVER,
    "金": shogi.GOLD,
    "角": shogi.BISHOP,
    "飛": shogi.ROOK
}

def kifu_to_usi_list(kifu):
    out = []
    for mv in kifu:
        if mv.get("usi"):
            out.append(mv["usi"]); continue
        # drop or move をフォールバックで USI 化
        if mv.get("type") == "drop" or (mv.get("from") is None and mv.get("drop")):
            kind = (mv.get("drop") or "").replace("+", "").upper()
            to_sq = mv.get("to_sq")
            if kind and to_sq: out.append(f"{kind}*{to_sq}")
        else:
            fs, ts = mv.get("from_sq"), mv.get("to_sq")
            promo  = bool(mv.get("promote"))
            if fs and ts: out.append(fs + ts + ("+" if promo else ""))
    return out

# 純粋な盤オブジェクトを返す内部関数
def make_initial_board():
    return shogi.Board()  # or shogi.Board(shogi.STARTING_SFEN)

def _get_user_id(data):
    # 旧キー混在への互換（段階的に userId に寄せればOK）
    return data.get("userId") or data.get("playerId") or data.get("userID") or data.get("id")

def index_to_usi(idx: int) -> str:
    c = idx % 9                # 0..8 （左0→右8）
    r = idx // 9               # 0..8 （上0→下8）
    file_num = 9 - c           # ★右から数えるので 9-c
    rank_chr = chr(ord('a') + r)
    return f"{file_num}{rank_chr}"

def usi_to_index(usi: str) -> int:
    file_num = int(usi[0])     # 1..9（右→左）
    rank_chr = usi[1]          # a..i（上→下）
    c = 9 - file_num           # 0..8（左→右）
    r = ord(rank_chr) - ord('a')
    return r * 9 + c

def get_captured_pieces(board, main, sub):
    def extract_pieces(color):
        pieces = []
        for piece_type, count in board.pieces_in_hand[color].items():
            symbol = shogi.Piece(piece_type, color).symbol().upper()
            pieces.extend([symbol] * count)
        return pieces

    black = extract_pieces(shogi.BLACK)
    white = extract_pieces(shogi.WHITE)
    first = match_states[(main, sub)]["first"]

    print("🔹 black = ",black,"🔹 white = ",white,"🔹 first = ",first)

    return {
        "main": black if first == "main" else white,
        "sub": white if first == "main" else black
    }

def build_board_matrix_from_snapshot(snap: dict):
    """
    最優先: snap["board"] が配列ならそれを返す
    次点   : board={"sfen": "..."} なら sfen から生成
    最後   : kifu の USI を適用して現在局面を作る
    """
    b = snap.get("board")
    if isinstance(b, list):
        return b

    # sfen から
    if isinstance(b, dict) and "sfen" in b:
        bd = shogi.Board(b["sfen"])
        return board_to_matrix(bd)

    # kifu から（あなたの保存に USI が入っている前提）
    moves = snap.get("moves") or [m.get("usi") for m in snap.get("kifu", []) if m.get("usi")]
    bd = shogi.Board()
    for u in moves:
        try:
            bd.push_usi(u)
        except Exception:
            break
    return board_to_matrix(bd)

# 既存の対局状態（例）
# key: (main, sub) → value: dict( board, kifu, captured, started, status, first, ... )
match_states: dict[tuple[str, str], dict] = {}

def persist_kifu_json(data: dict) -> str:
    """
    ★既存の棋譜保存関数をお使いください。
    ここでは例として kifu/ に保存します。
    """
    os.makedirs("kifu", exist_ok=True)

    ts = int(time.time())
    main = data["players"]["main"]
    sub  = data["players"]["sub"]
    fn = f'kifu/{ts}_{main}_vs_{sub}.json'
    with open(fn, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return fn

def hands_from_game(game):
    """game['captured'] から持ち駒カウントを作る"""
    def to_counts(lst):
        counts = {k: 0 for k in ["P", "L", "N", "S", "G", "B", "R"]}
        for s in lst or []:
            k = str(s).upper().replace("+", "")  # 成りは外す
            if k in counts:
                counts[k] += 1
        return counts

    cap = game.get("captured", {})
    return {
        "sente": to_counts(cap.get("player")),  # 先手＝YOU側の駒台
        "gote" : to_counts(cap.get("ai")),      # 後手＝AI側の駒台
    }

# モデルを初期化
# agent = PolicyAgent("models/shogi_policy_best.keras")
agent = PolicyAgent()

@app.post("/ai_move_policy")
def ai_move_policy():
    data = request.get_json()
    board = data["board"]          # 9x9 二次元リスト（例: [["P","",""],...])
    hands = data["hands"]          # {"sente": {...}, "gote": {...}}
    side  = data["side_to_move"]   # "sente" または "gote"
    legal_usi = data["legal_usi"]  # ["7g7f","P*5e",...]

    # 合法手を action_id に変換
    legal_ids = [usi_to_action_id(u) for u in legal_usi]

    # AI に手を選ばせる
    usi, prob = agent.select_move(board, hands, side, legal_ids, temperature=1.0, topk=20)

    return jsonify({"usi": usi, "prob": prob})

@app.post("/snapshot/resume")
def snapshot_resume_route():
    data = request.get_json(force=True)
    main = data["main"]; sub = data["sub"]; file = data["file"]

    snap = load_snapshot(file)
    if (snap.get("main"), snap.get("sub")) != (main, sub):
        return jsonify({"status":"error","message":"ペアID不一致"}), 400
    if snap.get("status") == "finished":
        return jsonify({"status":"error","message":"終局済みは再開不可"}), 400

    # ---- Board を復元（←これが重要）----
    bd = _rebuild_board_from_snapshot(snap)

    # 表示用9×9配列（Board -> Matrix）
    matrix = board_to_matrix(bd)

    # 手番を再計算
    ply   = len(snap.get("kifu", []))
    first = snap.get("first", "main")
    turn  = first if ply % 2 == 0 else ("sub" if first == "main" else "main")

    # match_states へ“対局中”として格納
    key = (main, sub)
    match_states[key] = {
        **snap,                 # 他のメタは活かす
        "board": bd,            # ← python-shogi の Board
        "board_matrix": matrix,
        "started": True,
        "status": "ongoing",
        "turn": turn,
        "phase": "playing",
        "resume_source": file,
        "reset_epoch": int(snap.get("reset_epoch", 0)) + 1,
    }
    return jsonify({"status":"ok"})

@app.post("/snapshot/list")
def snapshot_list_route():
    data = request.get_json(force=True)
    main, sub = data["main"], data["sub"]
    
    SNAPSHOT_DIR = BASE_DIR / "snapshots"
    fname = f"pvp_snapshot_{main}_vs_{sub}.json"
    path = SNAPSHOT_DIR / fname

    # ファイルが存在しなければ中断局面なし
    if not path.exists():
        return jsonify({"status": "ok", "items": []})

    # 読み込み
    try:
        snap = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print("[WARN] snapshot load failed:", e)
        return jsonify({"status": "error", "message": "snapshot read error"}), 500

    # resume_only が False なら再開対象ではない
    if not snap.get("resume_only", False):
        return jsonify({"status": "ok", "items": []})

    # ここまで来たら再開可能
    item = {
        "file": fname,
        "updated": snap.get("updated_at")
    }
    return jsonify({"status": "ok", "items": [item]})

def _next_turn(first: str, ply: int) -> str:
    # first: "main" or "sub"
    # ply: これまでの手数（kifu の長さ）
    # 偶数手後は first の手番、奇数手後は相手の手番
    if ply % 2 == 0:
        return first
    return "sub" if first == "main" else "main"

def _rebuild_board_from_snapshot(snap: dict) -> shogi.Board:
    """
    スナップショットから python-shogi の Board を復元する。
    - board が {"sfen": "..."} ならそれを使う
    - それ以外は kifu/moves の USI を初期局面から適用
    """
    b = snap.get("board")
    # 1) sfen を持っている保存形式
    if isinstance(b, dict) and "sfen" in b:
        return shogi.Board(b["sfen"])

    # 2) USI から復元（moves が無ければ kifu の usi を拾う）
    moves = snap.get("moves") or [m.get("usi") for m in snap.get("kifu", []) if m.get("usi")]
    bd = shogi.Board()
    for u in moves:
        try:
            bd.push_usi(u)
        except Exception:
            break
    return bd

@app.route("/initial_board")
def api_initial_board():
    fresh_board = make_initial_board()     # ← 内部ヘルパを呼ぶ
    return jsonify({
        "board": board_to_matrix(fresh_board),
        "captured": {"main": [], "sub": []}
    })

def board_to_matrix(board):
    matrix = [["" for _ in range(9)] for _ in range(9)]
    for square in shogi.SQUARES:
        piece = board.piece_at(square)
        if piece:
            row = square // 9
            col = square % 9
            symbol = piece.symbol().upper()
            name = piece_name_mapping.get(symbol, symbol)
            if piece.color == shogi.WHITE:
                name = "*" + name
            matrix[row][col] = name
    return matrix

# --- 評価関数をここに追加 ---
def evaluate_move(move, board):
    piece_values = {
        "P": 1, "L": 2, "N": 2, "S": 3,
        "G": 4, "B": 6, "R": 7, "K": 100
    }
    if board.is_legal(move):
        captured = board.piece_at(move.to_square)
        if captured:
            symbol = captured.symbol().upper().replace("+", "")
            return piece_values.get(symbol, 0)
    return 0

def square_to_usi(from_square, to_square, promote=False):
    if from_square is None or to_square is None:
        raise ValueError("from_square または to_square が None です（通常移動なのに）")

    #import shogi
    usi = shogi.SQUARE_NAMES[from_square] + shogi.SQUARE_NAMES[to_square]
    if promote:
        usi += "+"
    return usi

def init_game_states(player_id):
    game_states[player_id] = {
        "board": shogi.Board(),
        "kifu": [],
        "captured": {"player": [], "ai": []},
        "turn": "player",        # または "ai"
        "first": "player",       # ← 追加
        "result": "",            # ← 対局終了時に記録
        "reason": "",            # ← 対局終了時に記録
    }

    print(f"🔄 {player_id} の game_state を初期化しました")

def initial_board():
    board = shogi.Board()  # ← 初期局面の Board オブジェクト
    return board_to_matrix(board)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/enter_waiting", methods=["POST"])
def enter_waiting():
    data = request.get_json()
    user_id = data.get("id")
    if user_id:
        waiting_ids.add(user_id)
    return jsonify({"success": True})

#logged_in: set[str] = set()
#waiting_sub_ids: set[str] = set()

@app.route("/waiting_sub_ids")
def waiting_sub_ids_list():
    # ログイン中のIDだけ返す（ゴースト除去）
    ids = [uid for uid in waiting_sub_ids if uid in logged_in]
    exclude = request.args.get("exclude")  # 自分を除外したいとき用
    if exclude:
        ids = [uid for uid in ids if uid != exclude]
    return jsonify(sorted(ids))

@app.route("/send_request", methods=["POST"])
def send_request():
    data = request.get_json()
    from_id = data.get("from")
    to_id = data.get("to")
    first = data.get("first")  # "main" or "sub"

    if not (from_id and to_id and first in ["main", "sub"]):
        return jsonify({"success": False, "message": "不正なパラメータ"}), 400

    if to_id not in waiting_sub_ids:
        return jsonify({"success": False, "message": "相手は待機中ではありません"}), 400

    # リクエスト保存
    match_requests[to_id] = {
        "from": from_id,
        "first": first
    }
    print("🔶first=",first)

    return jsonify({"success": True})

@app.post("/login")
def login():
    data = request.get_json(force=True) or {}
    user_id = _get_user_id(data)
    if not user_id:
        return jsonify({"status": "error", "message": "ID必須です"}), 400
    if user_id in logged_in:
        return jsonify({"status": "error", "message": "すでに同じIDがログイン中です"}), 409

    # ゲーム状態を初期化して登録
    init_game_states(user_id)

    logged_in.add(user_id)
    return jsonify({"status": "ok", "userId": user_id})

@app.post("/logout")
def logout():
    data = request.get_json(force=True) or {}
    user_id = _get_user_id(data)
    if user_id:
        logged_in.discard(user_id)
        waiting_sub_ids.discard(user_id)  # ★ 待機リストからも除外
        # 対局関連の掃除（任意）
        for key in list(match_states.keys()):
            if user_id in key:
                del match_states[key]
        if user_id in game_states:
            del game_states[user_id]
    return jsonify({"status": "ok"})

@app.get("/is_logged_in")
def is_logged_in():
    uid = request.args.get("id") or request.args.get("userId")
    return jsonify({"logged_in": bool(uid and uid in logged_in)})

@app.route("/player_ids")
def player_ids():
    return jsonify(sorted(list(active_ids)))

@app.route("/kifu/<filename>")
def get_kifu_file(filename):
    filepath = os.path.join("saved_games", filename)
    if os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify(data)
    else:
        return jsonify({"error": "棋譜ファイルが見つかりません"}), 404

@app.route("/player_ids")
def get_player_ids():
    return jsonify(["maeda", "tanaka", "suzuki"])

@app.route("/reset", methods=["POST"])
def reset():
    data = request.get_json()
    player_id = data.get("player_id")

    if not player_id or player_id not in game_states:
        return jsonify({"success": False, "error": "invalid player_id"}), 400

    init_game_states(player_id)

    print(player_id,"のgame_statesをクリアしました")

    return jsonify({"success": True})

@app.route("/init", methods=["GET"])
def init():
    return jsonify({
        "board": board_to_matrix(board),
        "captured": {
            "player": captured_by_player,
            "ai": captured_by_ai
        }
    })

@app.route("/get_board", methods=["GET"])
def get_board():
    player_id = request.args.get("player_id")

    if not player_id or player_id not in game_states:
        return jsonify({"error": "未ログインまたはセッション切れです"}), 400

    game = game_states[player_id]
    board = game["board"]
    captured_by_player = game["captured"]["player"]
    captured_by_ai = game["captured"]["ai"]

    return jsonify({
        "board": board_to_matrix(board),
        "turn": "player" if board.turn == shogi.BLACK else "ai",
        "captured": {
            "player": captured_by_player,
            "ai": captured_by_ai
        }
    })


@app.route("/player_move", methods=["POST"])
def player_move():

    print("player_move A")

    data = request.get_json()
    player_id = data.get("player_id")
    from_index = data.get("from")
    to_index = data.get("to")
    promote = data.get("promote", False)
    piece_symbol = data.get("piece")  # 打ち込み用（歩など）

    if player_id not in game_states:
        return jsonify({"error": "未ログインまたはセッション切れです"}), 400
    
    print("player_move B")

    # 🧠 プレイヤーごとの状態を取得
    game = game_states[player_id]
    board = game["board"]
    captured_by_player = game["captured"]["player"]
    captured_by_ai = game["captured"]["ai"]

    print("board of game state at player move = ",board_to_matrix(board))

    try:
        # === 🟥 打ち込み処理 ===
        if from_index is None and piece_symbol:
            drop_piece_symbol = KANJI_TO_USI.get(piece_symbol, piece_symbol)  # "歩"→"P"
            drop_piece_type = USI_TO_SHOGI_CONST.get(drop_piece_symbol)

            print("🧪 [打ち込み] piece_symbol =", piece_symbol, "→ USI =", drop_piece_symbol)
            print("🧪 [打ち込み] to_index =", to_index)

            move = None
            for lm in board.legal_moves:
                if lm.drop_piece_type is not None:
                    if lm.to_square == to_index and lm.drop_piece_type == drop_piece_type:
                        move = lm
                        break

            if move is None:
                return jsonify({"error": "不正な打ち込みです"})

            if drop_piece_symbol in captured_by_player:
                captured_by_player.remove(drop_piece_symbol)
                print(f"✅ captured_by_playerから {drop_piece_symbol} を削除")
            else:
                print(f"⚠️ {drop_piece_symbol} は captured_by_player に存在しません")

        # === 🟩 通常の移動処理 ===
        else:
            from_square = from_index
            to_square = to_index

            move = None
            for lm in board.legal_moves:
                if lm.from_square == from_square and lm.to_square == to_square:
                    if promote and lm.promotion:
                        move = lm
                        break
                    elif not promote and not lm.promotion:
                        move = lm
                        break

            if move is None:
                return jsonify({"error": "不正な手です"})

            # === 🟨 捕獲処理 ===
            if board.piece_at(to_square):
                captured_piece = board.piece_at(to_square)
                if captured_piece:
                    captured_symbol = captured_piece.symbol().upper()
                    captured_by_player.append(captured_symbol)
                    print(f"📥 Player captured {captured_symbol}")

        board.push(move)
        game["kifu"].append(move.usi())   # ← 追加すべき
        game["turn"] = "ai"
        game["board"] = board

        print(f"📤 player_move により {player_id} の番を終了。次は AI")
        print("board = ",board_to_matrix(board))
        print("game_states=",game_states)

        return jsonify({
            "board": board_to_matrix(board),
            "captured": {
                "player": captured_by_player,
                "ai": captured_by_ai
            },
            "turn": "ai"  # ✅ ここが超重要！
        })

    except Exception as e:
        print("❌ エラー:", e)
        return jsonify({"error": str(e)})

@app.route("/ai_move", methods=["POST"])
def ai_move():

    from ai import choose_ai_move

    print("🟢 ai_move at A")

    data = request.get_json()
    player_id = data.get("player_id")
    
    if player_id not in game_states:
        return jsonify({"error": "未ログインまたはセッション切れです"}), 400
    
    print("🟢 ai_move at B")

    # 🧠 プレイヤーごとの状態を取得
    game = game_states[player_id]
    board = game["board"]
    captured_by_player = game["captured"]["player"]
    captured_by_ai = game["captured"]["ai"]
    ai_type = game.get("ai_type", "simple") 

    print(f"🤖 AIタイプ = {ai_type}")
    print("🔍 game['turn'] =", game["turn"])
    print("🔍 board.turn =", board.turn)

    # ✅ AIの手番でなければ拒否
    if game["turn"] != "ai":
        return jsonify({"error": "AIの手番ではありません (game.turn)"}), 400

    # ✅ board.turn もチェック（AIは後手＝WHITE）
    if board.turn != shogi.WHITE:
        print("⚠️ board.turn が WHITE ではないため強制的に修正します")
        board.turn = shogi.WHITE  # ← 念のため補正しておく
        game["board"] = board     # ← 状態を戻す

    print("🟢 ai_move at C")

    try:
        if ai_type == "learning": 
            # 盤面を policy 用に正規化（'*香' 等 → 'L' 等）
            raw9 = board_to_matrix(board)
            board9 = normalize_board_for_policy(raw9)
            print("🧪 [policy] board9[0][:3] =", board9[0][:3] if board9 else None)

            # 持ち駒は game_state から作成
            hands = hands_from_game(game)

            # 手番
            side = "gote" if board.turn == shogi.WHITE else "sente"

            # 合法手 → action_id
            legal_usi = [m.usi() for m in board.legal_moves]
            legal_ids = [usi_to_action_id(u) for u in legal_usi]

            # 推論
            usi, prob = agent.select_move(board9, hands, side, legal_ids, temperature=1.0, topk=20)
            print("🧪 [policy] selected:", usi, "prob=", prob)
            try:
                best_move = shogi.Move.from_usi(usi)
            except Exception:
                print("⚠️ [policy] usi→Move 失敗。simpleにフォールバック:", usi)
                best_move = choose_ai_move(board, ai_type="simple")

            # 念のため 合法手チェック
            if best_move not in board.legal_moves:
                print("⚠️ [policy] 非合法手検出。simpleにフォールバック:", best_move.usi())
                best_move = choose_ai_move(board, ai_type="simple")

        else:
            # simple / minimax は従来どおり
            best_move = choose_ai_move(board, ai_type=ai_type)

        print("🟢 ai_move at D")

        if not best_move:
            legal_moves = list(board.legal_moves)
            if not legal_moves:
                print("🚫 AIに合法手がありません（詰みまたは手詰まり）")
                game["result"] = "win"          # ← player視点
                game["reason"] = "checkmate"

                return jsonify({
                    "error": "AI has no legal moves",
                    "status": "checkmate",
                    "winner": "player"
                }), 200
            else:
                print("⚠ choose_ai_moveがNoneを返したため、ランダムにフォールバックします")
                best_move = random.choice(legal_moves)

        # === 打ち込みか判定 ===
        if "*" in best_move.usi():
            drop_piece = best_move.usi()[0]
            try:
                captured_by_ai.remove(drop_piece.upper())
            except ValueError:
                print(f"⚠ AIの駒台に {drop_piece.upper()} が見つかりません")

        else:
            captured_piece = board.piece_at(best_move.to_square)
            if captured_piece:
                symbol = captured_piece.symbol().upper()
                if captured_piece.color == shogi.BLACK:
                    captured_by_ai.append(symbol)
                else:
                    captured_by_player.append(symbol)

        board.push(best_move)
        game["kifu"].append(best_move.usi())
        game["turn"] = "player"
        game["board"] = board

        print("🟢 ai_move last")

        # ✅ 勝敗チェック（AIが勝ったか）
        if board.is_checkmate():
            game["result"] = "lose"     # ← player視点
            game["reason"] = "checkmate"
            return jsonify({
                "from": best_move.from_square,
                "to": best_move.to_square,
                "board": board_to_matrix(board),
                "captured": {
                    "player": captured_by_player,
                    "ai": captured_by_ai
                },
                "turn": "player",  # playerの番だがもう詰んでる
                "status": "checkmate",
                "winner": "ai",
                "is_check": True
            })

        # 通常処理（まだ詰んでいない）
        return jsonify({
            "from": best_move.from_square,
            "to": best_move.to_square,
            "board": board_to_matrix(board),
            "captured": {
                "player": captured_by_player,
                "ai": captured_by_ai
            },
            "turn": "player",
            "is_check": board.is_check()
        })
   
    except Exception as e:
        import traceback
        print("💥 [ai_move] 例外:", e)
        traceback.print_exc()
        # ゲームが止まらないよう、一時的に simple で代替
        try:
            fallback = choose_ai_move(board, ai_type="simple")
            if fallback:
                print("🛟 fallback: simple に切替")
                board.push(fallback)
                game["kifu"].append(fallback.usi())
                game["turn"] = "player"
                game["board"] = board
                return jsonify({
                    "from": fallback.from_square,
                    "to": fallback.to_square,
                    "board": board_to_matrix(board),
                    "captured": game["captured"],
                    "turn": "player",
                    "note": "policy-error-fallback"
                }), 200
        except Exception as e2:
            print("💥 fallbackも失敗:", e2)
        return jsonify({"error": f"AIエラー: {e.__class__.__name__}: {e}"}), 500


@app.route("/start", methods=["POST"])
def start_game():
    data = request.get_json()
    first = data.get("first", "player")
    player_id = data.get("player_id")
    ai_type = data.get("ai_type", "simple")

    print("🔸ai_type =", ai_type)

    # 🔁 状態を初期化（存在しなければ新規作成）
    init_game_states(player_id)

    game = game_states[player_id]
    board = game["board"]
    captured_by_player = game["captured"]["player"]
    captured_by_ai = game["captured"]["ai"]
    game["turn"] = first
    game["ai_type"] = ai_type
    game["first"] = first

    # 🔁 盤の初期化
    #reset_board(player_id)

    if first == "ai":
        # AIの手は返さず、クライアントが /ai_move を呼ぶ
        board.turn = shogi.WHITE
        game["turn"] = "ai"
        return jsonify({
            "board": board_to_matrix(board),
            "turn": "ai",
            "captured": {
                "player": captured_by_player,
                "ai": captured_by_ai
            }
        })

    else:
        game["turn"] = "player"
        board.turn = shogi.BLACK
        game["board"] = board   # これを追加　2025.6.14

        print("🔵 Board SFEN after start:", board.sfen())
        print("game_states=",game_states)

        return jsonify({
            "board": board_to_matrix(board),
            "turn": "player",
            "captured": {
                "player": captured_by_player,
                "ai": captured_by_ai
            }
        })

@app.route("/start_match_game", methods=["POST"])
def start_match_game():
    data = request.get_json()
    main = data["main"]
    sub = data["sub"]

    key = (main, sub)

    if key in match_states:
        match_states[key]["started"] = True
        match_states[key]["turn"] = "main"
        
        # ✅ 盤面を初期化（shogi.Board() → マトリクス形式に変換）
        board = shogi.Board()
        match_states[key]["board"] = board

        match_states[key]["captured"] = {
            "main": [],
            "sub": []
        }

        match_states[key]["kifu"] = []
        match_states[key]["winner"] = None

        # ✅ リセット関連の状態も初期化
        match_states[key]["reset_request"] = None
        match_states[key]["reset_accepted"] = False
        match_states[key]["resetting"] = False

        return jsonify({"status": "ok"})
    
    return jsonify({"status": "error", "message": "Match not found"})

@app.post("/save_kifu")
def save_kifu_route():
    data = request.get_json(force=True) or {}
    player_id = data.get("player_id") or data.get("userId") or data.get("id") or "unknown"

    game = game_states.get(player_id)
    if not game:
        return jsonify({"success": False, "message": "不明なプレイヤーIDです"}), 400

    kifu = game.get("kifu", [])
    board = game.get("board")
    if not kifu and not (hasattr(board, "move_stack") and len(board.move_stack) > 0):
        return jsonify({"success": False, "message": "まだ棋譜がありません"}), 400

    now = datetime.now().strftime("%Y%m%d-%H%M%S")
    ai_name  = game.get("ai_name")  or data.get("ai_name")  or "ai"
    ai_model = game.get("ai_model") or data.get("ai_model") or None

    payload = {
        "version": 1,
        "mode": "ai",
        "timestamp": now,
        "player_id": player_id,
        "ai_name": ai_name,
        "ai_model": ai_model,
        "first": game.get("first", "unknown"),
        "result": game.get("result", "unknown"),
        "reason": game.get("reason", "unknown"),
        "kifu": kifu,          # 内部リッチデータ
    }

    # ★ 統一仕様：kifu/ai に直接保存
    ai_dir = BASE_DIR / "kifu" / "ai"
    ai_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{now}_ai_{player_id}_vs_{ai_name}.json"
    out_path = ai_dir / filename
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    rel_path = str(out_path.relative_to(BASE_DIR))
    return jsonify({"success": True, "filename": filename, "path": rel_path})

def _dated_dir(mode: str, ts: str) -> Path:
    # ts: "YYYYMMDD-HHMMSS"
    year, month = ts[:4], ts[4:6]
    d = KIFU_ROOT / mode / year / month
    d.mkdir(parents=True, exist_ok=True)
    return d

def _get_user_id(data: dict):
    # 互換: 旧キー混在を吸収
    return data.get("userId") or data.get("playerId") or data.get("userID") or data.get("id")

def _resolve_match_from_payload(data: dict):
    """
    main/sub が来ていればその組を返す。
    ない場合は userId を含む started=True の組を探索。
    0件→(None,None) / 2件以上→("conflict",None)
    """
    main = data.get("main") or data.get("main_id")
    sub  = data.get("sub")  or data.get("sub_id")
    if main and sub:
        key = (main, sub)
        return key, match_states.get(key)

    uid = _get_user_id(data)
    if not uid:
        return None, None

    candidates = []
    for key, match in match_states.items():
        if not match or not match.get("started"):
            continue
        if uid in key:
            candidates.append((key, match))

    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) == 0:
        return None, None
    return "conflict", None

@app.post("/save_kifu2")
def save_kifu2_route():
    data = request.get_json(force=True) or {}
    key, match = _resolve_match_from_payload(data)
    if key == "conflict":
        return jsonify({"success": False, "error": "対象の対局が複数。main/sub を指定してください"}), 400
    if not match:
        return jsonify({"success": False, "error": "対局が見つかりません"}), 404

    main, sub = key
    kifu = match.get("kifu", [])
    if not kifu:
        return jsonify({"success": False, "error": "まだ棋譜がありません"}), 400

    # 対局状態の取得（終局かどうか判定に使う）
    status = match.get("status") or "ongoing"
    winner = match.get("winner")
    finished = (status == "finished") or bool(winner)

    now = datetime.now().strftime("%Y%m%d-%H%M%S")
    moves_usi = kifu_to_usi_list(kifu)

    rel_path = None
    filename = None

    # ---- 終局したときだけ kifu/pvp に保存する ----
    if finished:
        payload = {
            "version": 1,
            "mode": "pvp",
            "timestamp": now,
            "main": main,
            "sub": sub,
            "first": match.get("first"),
            "winner": winner,
            "reason": match.get("reason"),
            "kifu": kifu,       # 内部検証用
            "moves": moves_usi, # 再生/学習用
        }

        pvp_dir = BASE_DIR / "kifu" / "pvp"
        pvp_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{now}_pvp_{main}_vs_{sub}.json"
        out_path = pvp_dir / filename
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        rel_path = str(out_path.relative_to(BASE_DIR))

    # ---- ここから：スナップショット保存（中断時のみ） ----
    try:
        if not finished:
            # 盤を JSON 可能な 9x9 配列にサニタイズ
            board_obj = match.get("board")
            if isinstance(board_obj, list):
                board_matrix = board_obj
            else:
                # ★ あなたの関数を使う：Board → 9x9 文字列配列
                board_matrix = board_to_matrix(board_obj)

            # 持ち駒・棋譜も JSON 化（list/dict ならそのまま）
            captured = match.get("captured", {"main": [], "sub": []})
            kifu_safe = match.get("kifu", [])

            # スナップショット用に “JSONだけ” の軽量 dict を作る
            safe = {
                "main": main,
                "sub": sub,
                "first": match.get("first", "main"),
                "started": bool(match.get("started", False)),
                "status": "ongoing",                 # accepted等でも再開可能に正規化
                "winner": None,
                "board": board_matrix,
                "captured": captured,
                "kifu": kifu_safe,
                "updated_at": now,
            }

            # 再開専用フラグ付きで保存（ペアごとに1ファイル上書き）
            save_snapshot((main, sub), safe, resume_only=True, status_override="ongoing")

    except Exception as e:
        print(f"[WARN] save_snapshot failed: {e}")
    # ---- スナップショット部分ここまで ----

    # 終局時は filename/path を返す。中断時は None が入るが、フロントが
    # それらを使っていなければ問題なし（メッセージ表示だけならOK）。
    return jsonify({"success": True, "filename": filename, "path": rel_path})

@app.get("/kifu_list")
def kifu_list():
    """
    棋譜一覧を返す。
      - /kifu_list?kind=ai    → kifu/ai を列挙（デフォルト）
      - /kifu_list?kind=pvp   → kifu/pvp を列挙
      - /kifu_list?kind=all   → 2つをまとめて列挙
      - /kifu_list?limit=100  → 返却件数を制限（新しい順）
    """
    kind  = (request.args.get("kind") or "ai").lower()  # ai | pvp | all
    limit = request.args.get("limit", type=int)
    base  = BASE_DIR / "kifu"

    targets = []
    if kind == "ai":
        targets = [base / "ai"]
    elif kind == "pvp":
        targets = [base / "pvp"]
    else:  # "all"
        targets = [base / "ai", base / "pvp"]

    results = []
    for folder in targets:
        if not folder.exists():
            continue
        for filename in os.listdir(folder):
            if not filename.endswith(".json"):
                continue
            path = folder / filename
            if not path.is_file():
                continue

            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception as e:
                print(f"[kifu_list] skip {path.name}: {e}")
                continue

            mode = data.get("mode") or ("ai" if folder.name == "ai" else "pvp")
            ts   = data.get("timestamp", "")

            # 共通化した表示用メタ
            if mode == "ai":
                label_left  = data.get("player_id", "you")
                label_right = data.get("ai_name", "ai")
            else:  # pvp
                label_left  = data.get("main", "main")
                label_right = data.get("sub", "sub")

            kifu_raw = data.get("kifu", [])
            moves    = data.get("moves", [])  # pvpで USI 配列を別に置いていれば拾う
            kifu_len = len(moves) if moves else len(kifu_raw)

            results.append({
                "filename": filename,
                "mode": mode,                  # "ai" or "pvp"
                "timestamp": ts,
                "players": [label_left, label_right],
                "kifu_len": kifu_len,
                "path": str(path.relative_to(BASE_DIR)),
            })

    # 新しい順に並べ替え（タイムスタンプっぽい名前を想定）
    results.sort(key=lambda x: x["timestamp"], reverse=True)
    if limit is not None and limit > 0:
        results = results[:limit]

    return jsonify(results)

@app.post("/load_kifu")
def load_kifu():
    data = request.get_json(force=True) or {}
    # 例: "kifu/ai/20251026_ai_donau_vs_ai.json"
    rel_path = data.get("path")
    if not rel_path:
        return jsonify({"status": "error", "message": "path が必要です"}), 400

    p = (BASE_DIR / rel_path).resolve()
    if not p.is_file():
        return jsonify({"status": "error", "message": "ファイルが見つかりません"}), 404

    try:
        payload = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        return jsonify({"status": "error", "message": f"JSON読込失敗: {e}"}), 400

    mode = payload.get("mode", "ai")

    # 共通部分
    resp = {
        "status":    "ok",
        "mode":      mode,
        "timestamp": payload.get("timestamp"),
        "path":      rel_path,                 # 画面表示用
        "kifu":      payload.get("kifu", []),
        "moves":     payload.get("moves", []),
        "first":     payload.get("first"),
        "reason":    payload.get("reason"),
    }

    if mode == "pvp":
        # PVP用のメタ情報をそのまま返す
        resp["main"]   = payload.get("main")
        resp["sub"]    = payload.get("sub")
        resp["winner"] = payload.get("winner")  # ← ここが重要
    else:
        # AI対局用（既存形式との互換）
        players = payload.get("players")
        if not players:
            players = [payload.get("player_id"), payload.get("ai_name")]
        resp["players"] = players
        # result or winner のどちらかを result として返す
        resp["result"] = payload.get("result") or payload.get("winner")

    return jsonify(resp)

@app.route("/resign", methods=["POST"])
def resign():   
    data = request.get_json()
    player_id = data.get("player_id")

    return jsonify(success=True)

@app.post("/resign2")
def resign2_route():
    print("❌ resign2 start")
    data = request.get_json(force=True) or {}
    key, match = _resolve_match_from_payload(data)
    print("🔴 match = ",match)
    print("🔴 match.get('started')",match.get("started"))
    if key == "conflict":
        return jsonify({"success": False, "error": "対象対局が複数。main/sub を指定してください"}), 400
    if not match or not match.get("started"):
        return jsonify({"success": False, "error": "対局が見つからないか、未開始です"}), 404

    # ★ ここで必ず展開しておく
    main, sub = key

    resigner = data.get("resigner")
    if resigner not in ("main", "sub"):
        uid = _get_user_id(data)
        if uid == key[0]: resigner = "main"
        elif uid == key[1]: resigner = "sub"
    if resigner not in ("main", "sub"):
        return jsonify({"success": False, "error": "resigner を main/sub で指定してください"}), 400

    # 既に終局ならそのまま返す（冪等）
    print("❌ winner at resign2 分岐1",match.get("winner"))
    print("❌ reason at resign2 分岐1",match.get("reason"))

    # サーバ状態の真実は finished/winner/reason のセットで判断
    if match.get("finished") or (match.get("winner") is not None):
        return jsonify({
            "success": True,
            "finished": True,
            "winner": match.get("winner"),
            "resigner": match.get("resigner"),
            "resigner_id": key[0] if match.get("resigner") == "main" else key[1],
            "reason": match.get("reason"),
            "terminal": True,
        })

    opponent = "sub" if resigner == "main" else "main"
    now = datetime.now().strftime("%Y%m%d-%H%M%S")

    match["winner"]   = opponent
    match["resigner"] = resigner
    match["reason"]   = "resign"
    match["ended_at"] = now
    #match["started"]  = False

    # 今回の投了で終局にした直後の返却
    print("⭕️resigner at reason2 分岐2= ",resigner,"⭕️winner at reason2 分岐2= ",opponent)
    return jsonify({
        "success": True,
        "finished": True,
        "winner": opponent,
        "resigner": resigner,                                   # "main" or "sub"
        "resigner_id": main if resigner == "main" else sub,     # ★追加
        "reason": "resign",
        "terminal": True,
    })

@app.get("/match_status2")   # 相手側通知用の軽量ポーリング
def match_status2_route():
    main = request.args.get("main") or request.args.get("main_id")
    sub  = request.args.get("sub")  or request.args.get("sub_id")
    if not main or not sub:
        return jsonify({"success": False, "error": "main / sub が必要です"}), 400

    match = match_states.get((main, sub))
    if not match:
        return jsonify({"success": False, "error": "対局が見つかりません"}), 404

    return jsonify({
        "success": True,
        "started": bool(match.get("started")),
        "finished": bool(match.get("winner")),
        "winner": match.get("winner"),
        "resigner": match.get("resigner"),
        "reason": match.get("reason"),
        "kifu_len": len(match.get("kifu", [])),
        "first": match.get("first"),
        "ended_at": match.get("ended_at"),
    })

@app.route("/wait_as_sub", methods=["POST"])
def wait_as_sub():
    data = request.get_json()
    sub_id = data.get("id")
    if sub_id:
        waiting_sub_ids.add(sub_id)
    return jsonify({"status": "waiting"})

@app.route("/check_match_request")
def check_match_request():
    sub_id = request.args.get("id")
    req = match_requests.get(sub_id)
    if req:
        return jsonify({
            "requested": True,
            "from": req["from"],
            "first": req["first"]
        })
    else:
        return jsonify({"requested": False})

@app.route("/accept_match", methods=["POST"])
def accept_match():
    data = request.get_json()
    main = data["main"]
    sub = data["sub"]
    first = data["first"]  # "main" または "sub"

    # ✅ 初期状態を match_states に登録
    match_states[(main, sub)] = {
        "main": main,
        "sub": sub,
        "first": first,
        "status": "accepted",
        "kifu": [],  # 棋譜は空から開始
        "winner": None,
        "board": initial_board(),  # 初期盤面（関数で用意しておく）
        "captured": {"main": [], "sub": []},  # 駒台
        "last_comment": "",
        "last_sent_kifu_len": {"main": 0, "sub": 0},  # ★ 各プレイヤーに送信済みの手数
        "reset_request": None,        # ★ リセット要求情報（なければ None）
        "reset_accepted": None,       # ★ リセット承諾通知先（"main" または "sub"）
        "reset_in_progress": False,    # ★ リセット処理中かどうか（True → move 出さない）
        "reset_epoch": 0         # ← 追加
    }

    print(f"🟢accept_matchにより登録: {match_states[(main, sub)]}")
    return jsonify({"status": "ok"})

@app.route("/cancel_sub_wait", methods=["POST"])
def cancel_sub_wait():
    data = request.get_json()
    sub_id = data["id"]
    waiting_sub_ids.discard(sub_id)
    match_requests.pop(sub_id, None)
    return jsonify({"status": "cancelled"})

@app.route("/check_match_status")
def check_match_status():
    main_id = request.args.get("main_id")
    sub_id = request.args.get("sub_id")
    key = (main_id, sub_id)

    match = match_states.get(key)

    if match and match.get("status") == "accepted":
        return jsonify({
            "status": "accepted",
            "first": match["first"]
        })
    else:
        return jsonify({"status": "waiting"})

@app.route("/match_board")
def match_board():
    role = request.args.get("role")
    player_id = request.args.get("player_id")
    first = request.args.get("first")
    main_id = request.args.get("main_id")
    sub_id = request.args.get("sub_id")

    # ✅ 初回のみ初期登録
    key = (main_id, sub_id)
    if key not in match_states:
        match_states[key] = {
            "first": first,
            "moves": [],
            "turn": first,
            "winner": None,
            "reason": None,
        }

    return render_template("match_board.html",
                           role=role,
                           player_id=player_id,
                           first=first,
                           main_id=main_id,
                           sub_id=sub_id)

@app.post("/get_match_board")
def get_match_board():
    data = request.get_json(force=True) or {}
    main = data.get("main")
    sub  = data.get("sub")
    role = data.get("player") or data.get("role")  # 後方互換（player優先）

    if not main or not sub or role not in ("main", "sub"):
        return jsonify({"status": "error", "message": "main/sub/role が不正です"}), 400

    key = (main, sub)
    match = match_states.get(key)
    if not match:
        return jsonify({"status": "error", "message": "対局が存在しません"}), 404

    # ---- 先後・状態を取り出し ----
    first       = match.get("first", "main")                 # "main" or "sub"
    b           = match.get("board")                         # shogi.Board か 9x9配列 か None
    kifu        = match.get("kifu", [])
    kifu_len    = len(kifu)
    winner      = match.get("winner")                        # None / "main" / "sub"
    captured    = match.get("captured") or {"main": [], "sub": []}
    if "main" not in captured: captured["main"] = captured.get("main", [])
    if "sub"  not in captured: captured["sub"]  = captured.get("sub",  [])

    reset_epoch = match.get("reset_epoch", 0)

    # ---- board を「描画可能な 9x9」に正規化 ----
    board_matrix = match.get("board_matrix")  # 既に用意済みなら最優先
    if board_matrix is None:
        if isinstance(b, list):
            # スナップショット再開などで 9x9 が格納済み
            board_matrix = b
        elif b is not None:
            # python-shogi の Board → 9x9
            board_matrix = board_to_matrix(b)
        # ここで None なら後で空盤を返す

    # ---- 手番 turn を安全に決定 ----
    turn_role = match.get("turn")
    if turn_role not in ("main", "sub"):
        if (b is not None) and (not isinstance(b, list)):
            # shogi.Board があれば BLACK/WHITE から決定
            black_role = first                                  # 先手(BLACK)は first 側
            white_role = "sub" if first == "main" else "main"   # 後手(WHITE)はもう一方
            turn_role  = black_role if b.turn == shogi.BLACK else white_role
        else:
            # 偶奇で補完（偶数手後は first の手番）
            turn_role = first if (kifu_len % 2 == 0) else ("sub" if first == "main" else "main")

    is_my_turn = (role == turn_role)

    # ---- フェーズ判定 ----
    if winner is not None:
        phase = "ended"
    else:
        if board_matrix is None:
            phase = "idle"     # 未開始：空盤で返す
        elif kifu_len == 0:
            phase = "init"     # 初手前（描画あり）
        else:
            phase = "playing"  # 対局中

    # ---- board_matrix をキャッシュ（次回以降の高速化 & 再開直後の安定化）----
    if board_matrix is not None:
        match["board_matrix"] = board_matrix

    # ログ（任意）
    print(
        f"[get_match_board] first={first} turn={turn_role} req={role} "
        f"is_my_turn={is_my_turn} phase={phase} kifu_len={kifu_len} "
        f"winner={winner} epoch={reset_epoch}"
    )

    # ---- レスポンス（盤が無ければ空9x9を返す） ----
    return jsonify({
        "status": "ok",
        "phase": phase,                       # "idle" / "init" / "playing" / "ended"
        "first": first,                       # "main" or "sub"
        "turn": turn_role,                    # "main" / "sub"
        "is_my_turn": is_my_turn,             # スネーク（新）
        "isMyTurn": is_my_turn,               # キャメル（互換）
        "kifu_len": kifu_len,
        "winner": winner,
        "reset_epoch": reset_epoch,
        "board": board_matrix if board_matrix is not None else [[""] * 9 for _ in range(9)],
        "captured": captured,
    })

@app.route("/check_match_start", methods=["POST"])
def check_match_start():
    data = request.get_json()
    main = data["main"]
    sub = data["sub"]
    key = (main, sub)

    match = match_states.get(key)
    if match and match.get("started"):
        return jsonify({
            "started": True,
            "first": match["first"]
        })
    else:
        return jsonify({"started": False})

@app.route("/reset_match_game", methods=["POST"])
def reset_match_game():
    print("🔶reset_match_game started!")
    data = request.get_json()
    main = data["main"]
    sub = data["sub"]
    key = (main, sub)

    # 対局が存在しない場合はエラー
    if key not in match_states:
        return jsonify({"status": "error", "message": "対局が存在しません"})

    # 先手情報などを保持
    first = match_states[key].get("first", "main")

    # 対局状態を初期化
    match_states[key] = {
        "main": main,
        "sub": sub,
        "first": first,
        "kifu": [],
        "board": create_initial_board_matrix(),  # 下で定義します
        "captured": {
            "main": [],
            "sub": []
        },
        "started": False,
        "winner": None
    }

    print(f"🔁 対局 {key} をリセットしました")

    # ✅ サブ側に通知を送る（再描画用URLを格納）
    #match_states[key]["sub_reload_url"] = f"/match_board?main_id={main}&sub_id={sub}&role=sub&first={first}&player_id={sub}"

    # Flaskの reset_match_game()
    return jsonify({"status": "ok", "reset": True})

def create_initial_board_matrix():
    # 上段（後手側）
    row0 = ["香", "桂", "銀", "金", "玉", "金", "銀", "桂", "香"]
    row1 = ["", "飛", "", "", "", "", "", "角", ""]
    row2 = ["歩"] * 9
    row3 = [""] * 9
    row4 = [""] * 9
    row5 = [""] * 9
    row6 = ["歩"] * 9
    row7 = ["", "角", "", "", "", "", "", "飛", ""]
    row8 = ["香", "桂", "銀", "金", "王", "金", "銀", "桂", "香"]

    return [row0, row1, row2, row3, row4, row5, row6, row7, row8]

@app.route("/check_match_reset", methods=["POST"])
def check_match_reset():
    data = request.get_json()
    main = data["main"]
    sub = data["sub"]
    key = (main, sub)

    match = match_states.get(key)
    if not match:
        return jsonify({"status": "not_found"})

    # 「リセットされた」とは、started=False かつ kifu=[] の状態
    is_reset = not match.get("started", False) and len(match.get("kifu", [])) == 0

    return jsonify({"status": "ok", "reset": is_reset})

@app.route("/submit_match_move", methods=["POST"])
def submit_match_move():
    try:
        data = request.get_json(force=True) or {}
        main = data["main"]
        sub  = data["sub"]
        role = data["role"]              # "main" / "sub"
        from_index = data["from"]
        to_index   = data["to"]
        promote    = bool(data.get("promote", False))
        drop_piece = data.get("drop")    # 打ち込み時のみ

        key = (main, sub)
        match = match_states.get(key)
        if not match:
            return jsonify({"status": "error", "message": "対局が存在しません"}), 404

        board = match.get("board")
        if not isinstance(board, shogi.Board):
            return jsonify({"status": "error", "message": "盤が初期化されていません"}), 400

        # すでに終局なら冪等返却
        if match.get("finished") or (match.get("winner") is not None):
            return jsonify({
                "status":   "error",
                "message":  "対局は終了しています",
                "finished": True,
                "winner":   match.get("winner"),
                "reason":   match.get("reason"),
            }), 400

        # ---- 手番チェック ----
        is_black_turn   = (board.turn == shogi.BLACK)
        is_black_player = (match.get("first", "main") == role)  # 先手 = first
        if is_black_turn != is_black_player:
            return jsonify({"status": "error", "message": "まだあなたの番ではありません"}), 400

        # ---- 入力の軽い妥当性 ----
        if to_index is None or not (0 <= int(to_index) <= 80):
            return jsonify({"status": "error", "message": "to が不正です"}), 400
        if from_index is not None and not (0 <= int(from_index) <= 80):
            return jsonify({"status": "error", "message": "from が不正です"}), 400

        # ---- USI 生成 ----
        from_sq = index_to_usi(from_index) if from_index is not None else None
        to_sq   = index_to_usi(to_index)

        # ★ ここを先に初期化（未定義バグ防止）
        is_drop   = False
        drop_norm = None

        if from_index is None:
            # 打ち込み: 例 "P*7f"
            is_drop = True
            if not drop_piece:
                return jsonify({"status": "error", "message": "打ち込みの駒が指定されていません"}), 400
            if promote:
                # 打ち込みで promote は無効
                promote = False
            drop_norm = drop_piece.replace("+", "").upper()
            move_str  = f"{drop_norm}*{to_sq}"
        else:
            # 駒移動: 例 "7g7f+"
            move_str  = from_sq + to_sq + ("+" if promote else "")

        move = shogi.Move.from_usi(move_str)
        if move not in board.legal_moves:
            return jsonify({
                "status":   "error",
                "message":  "不正な手です" + ("（王手を受けています）" if board.is_check() else ""),
                "in_check": board.is_check(),
            }), 400

        # ---- 手を適用 ----
        board.push(move)

        # ---- 毎手後の captured をサーバで再計算して正規化 ----
        captured_now = get_captured_pieces(board, main, sub)
        match["captured"] = captured_now

        # ---- 棋譜に記録（USI/打ち込み種別も保持）----
        match.setdefault("kifu", []).append({
            "type":    "drop" if is_drop else "move",
            "from":    from_index,          # 数値 index（互換）
            "to":      to_index,            # 数値 index（互換）
            "from_sq": from_sq,             # USI（読みやすさ）
            "to_sq":   to_sq,               # USI
            "drop":    drop_norm if is_drop else None,   # 例: "P","B"
            "usi":     move_str,                           # "P*7f" / "7g7f+"
            "promote": bool(promote),
            "by":      role,
        })
        match["last_comment"] = data.get("comment", "")

        # ---- 次手番の role を保存（/get_match_move の補助）----
        first = match.get("first", "main")
        black_role = first
        white_role = "sub" if first == "main" else "main"
        match["turn_role"] = black_role if board.turn == shogi.BLACK else white_role

        # ---- 勝敗判定（詰み）----
        if not match.get("finished"):              # 多重終局防止
            if board.is_checkmate():
                match["winner"]   = role           # 今の手を指した側が勝者
                match["reason"]   = "checkmate"
                match["finished"] = True
                match["resigner"] = None

        # ---- レスポンス ----
        return jsonify({
            "status":    "move",
            "board":     board_to_matrix(board),
            "captured":  match["captured"],        # サーバ計算の確定値
            "winner":    match.get("winner"),
            "reason":    match.get("reason"),
            "finished":  bool(match.get("finished")),
            "promote":   promote,
            "in_check":  board.is_check(),         # 受け手（これから指す側）が王手中か？
            "by":        role,                     # 自己エコー弾き用
            "kifu_len":  len(match["kifu"]),       # クライアント同期に必須
            "turn":      match.get("turn_role"),   # "main"/"sub"
        })

    except Exception as e:
        # どこで落ちても JSON を返す（フロントの Unexpected token 回避）
        app.logger.exception("submit_match_move failed")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/get_match_move", methods=["POST"])
def get_match_move():
    data = request.get_json(force=True) or {}
    main = data.get("main")
    sub  = data.get("sub")
    role = data.get("role")  # "main" or "sub"

    key = (main, sub)
    match = match_states.get(key)
    if not match:
        return jsonify({"status": "error", "message": "対局が存在しません"}), 404

    # --- デフォルト整備 ---
    match.setdefault("kifu", [])
    match.setdefault("captured", {"main": [], "sub": []})
    match.setdefault("reset_requested", False)   # dict or False
    match.setdefault("reset_accepted", False)
    match.setdefault("resetting", False)
    match.setdefault("reset_epoch", 0)
    # 盤面
    b = match.get("board")   # python-shogi の Board または None の可能性

    # ========== ヘルパ ==========
    def phase_of(m):
        if m.get("winner") is not None:
            return "ended"
        return "init" if len(m.get("kifu", [])) == 0 else "playing"
    
    # 直前の手番のロールを求めるユーティリティ（ルート内で定義）
    def _last_by(m):
        k = m.get("kifu", [])
        return (k[-1].get("by") if k else None)

   
    def base_fields(m):
        kifu = m.get("kifu", [])
        last_by = kifu[-1]["by"] if kifu else None
        return {
            "kifu_len": len(kifu),
            "comment":  m.get("last_comment",""),
            "reset_epoch": m.get("reset_epoch",0),
            "phase": "ended" if m.get("winner") is not None else ("init" if not kifu else "playing"),
            #"last_by": last_by,
            "last_by": _last_by(m), 
        }

    def board_matrix_safe(bb):
        if isinstance(bb, shogi.Board):
            return board_to_matrix(bb)
        app.logger.error(f"BUG: match['board'] is not shogi.Board but {type(bb)}")
        return [[""] * 9 for _ in range(9)]

    def in_check_safe(bb):
        try:
            return bool(isinstance(bb, shogi.Board) and bb.is_check())
        except Exception:
            return False
    
    # ========== A) 終局は常に即返す ==========
    print("🔴 終局時の分岐")
    print("🔴 winner = ",match.get("winner"))
    print("🔴 result = ",match.get("result"))

    # 推奨：finished で一本化（設定忘れがないように）
    if match.get("finished") or (match.get("winner") is not None):
        saved_resigner = match.get("resigner")
        saved_resigner_id = key[0] if saved_resigner == "main" else key[1] if saved_resigner == "sub" else None
        return jsonify({
            **base_fields(match),   # 共通は先
            "status": "end",
            "finished": True,
            "reason": match.get("reason"),
            "winner": match.get("winner"),
            "resigner": saved_resigner,
            "resigner_id": saved_resigner_id,
            "board": board_matrix_safe(match.get("board")),
            "captured": match.get("captured", {"main": [], "sub": []}),
        })
  
    # ========== B) リセット承諾：初期化 → 一回だけ通知 ==========
    if match.get("reset_accepted"):
        # 世代カウンタを進めて、状態を初期化
        match["reset_epoch"] = match.get("reset_epoch", 0) + 1
        match["kifu"] = []
        match["board"] = initial_board()              # ★ 内部ヘルパ：shogi.Board を返す関数
        match["captured"] = {"main": [], "sub": []}
        match["winner"] = None
        match["reason"] = None
        match["resigner"] = None
        match["reset_requested"] = False
        match["resetting"] = False
        match["reset_accepted"] = False               # ★ このレスで通知したら下げる（連続通知防止）

        b = match["board"]
        return jsonify({
            **base_fields(match), 
            "status": "resync",                       # クライアントはフル同期へ
            "reset_accepted": True,
            "board": board_matrix_safe(b),
            "captured": match["captured"],
            #**base_fields()
        })

    # ========== C) リセット要求（承諾待ち） ==========
    if match.get("reset_requested"):
        req = match["reset_requested"] if isinstance(match["reset_requested"], dict) else {}
        return jsonify({
            **base_fields(match), 
            "status": "ok",
            "reset_requested": True,
            "from": req.get("from"),
            "comment": req.get("comment", ""),
            #**base_fields()
        })

    # ========== D) サーバ側リセット中は待機 ==========
    if match.get("resetting"):
        return jsonify({"status": "wait", **base_fields(match)})

    # ========== E) クライアントの棋譜長を解釈（未定義だった箇所） ==========
    kifu = match["kifu"]
    srv_len = len(kifu)                                           # ★ 追加：サーバ長
    raw_client_len = data.get("client_kifu_len", 0)
    try:
        client_len = int(raw_client_len)                          # ★ 追加：クライアント長
    except Exception:
        client_len = -1  # 不正値は resync を促す

    # クライアントが“進み過ぎ or 不正”なら resync 指示
    if client_len < 0 or client_len > srv_len:
        return jsonify({"status": "resync", **base_fields(match)})

    # ========== F) 通常の新着手（未定義だった print も補完） ==========
    app.logger.info("get_match_move: srv_len=%s client_len=%s", srv_len, client_len)
    if srv_len > client_len and srv_len > 0:
        last_move = kifu[-1]
        return jsonify({
            **base_fields(match), 
            "finished": bool(match.get("winner")),         # ← 終局したか
            "reason":   match.get("reason"),               # "resign" / "checkmate" など
            "winner":   match.get("winner"),               # "main" / "sub"
            "resigner": match.get("resigner"),             # 投了なら "main"/"sub"
            "status":  "move",
            "from":    last_move.get("from"),
            "to":      last_move.get("to"),
            "promote": last_move.get("promote", False),
            "drop":    last_move.get("drop", False),
            "by":      last_move.get("by"),                # 自分エコー弾き用
            "board":   board_matrix_safe(match.get("board")),
            "captured": match.get("captured", {"main": [], "sub": []}),
            "in_check": in_check_safe(match.get("board")),
            "kifu_len": srv_len,
            # 可能なら「今の手番」も補助で
            "turn": match.get("turn_role") or None,       # あれば "main"/"sub"
            #**base_fields()
        })

    # ========== G) 変化なし ==========
    return jsonify({"status": "wait", **base_fields(match)})

@app.route("/get_sub_reload_url", methods=["POST"])
def get_sub_reload_url():
    data = request.get_json()
    main = data["main"]
    sub = data["sub"]
    key = (main, sub)

    match = match_states.get(key)
    if match and "sub_reload_url" in match:
        return jsonify({"status": "ok", "url": match["sub_reload_url"]})
    else:
        return jsonify({"status": "wait"})
    
@app.route("/request_reset_match", methods=["POST"])
def request_reset_match():
    data = request.get_json()
    main = data["main"]
    sub = data["sub"]
    comment = data.get("comment", "")

    key = (main, sub)
    match = match_states.get(key)

    if not match:
        return jsonify({"status": "error", "message": "対局が存在しません"})

    # ✅ 既存のmoveを一時的に退避または削除
    match["last_move_backup"] = match.get("kifu", [])[-1] if match.get("kifu") else None
    match["kifu"] = []  # これで status: "move" は返らなくなる

    # ✅ リセットリクエストを登録
    match["reset_requested"] = {
        "from": data.get("role", "main"),
        "comment": comment
    }
    match["resetting"] = True

    print("♻️ リセットリクエストが出されました", match["reset_requested"])
    return jsonify({"status": "ok"})

@app.route("/accept_reset_request", methods=["POST"])
def accept_reset_request():
    print("🟢reset_accepted!")
    data = request.get_json()
    main = data["main"]
    sub = data["sub"]
    key = (main, sub)

    if key not in match_states:
        return jsonify({"status": "error", "message": "対局が存在しません"})

    #match_states[key]["reset_accepted"] = "main"
    match_states[key]["reset_accepted"] = True

    # ✅ リセットリクエスト削除
    match_states[key].pop("reset_requested", None)

    # ✅ 不要なら move のバックアップも削除（resetGame2 側で初期化処理を行う想定）
    match_states[key].pop("last_move_backup", None)

    print("🟢reset_accepted=",match_states[key]["reset_accepted"])

    return jsonify({"status": "ok"})

@app.route("/leave_match", methods=["POST"])
def leave_match():
    data = request.get_json()
    main = data["main"]
    sub = data["sub"]
    key = (main, sub)

    del match_states[key] 
    #match_states[key] = {}

    return jsonify({"status": "ok"})

@app.post("/force_reset_match")
def force_reset_match():
    data = request.get_json(force=True) or {}
    main = data.get("main"); sub = data.get("sub")
    swap_first = bool(data.get("swap_first"))
    key = (main, sub)

    match = match_states.get(key)
    if not match:
        return jsonify({"ok": False, "message": "対局が存在しません"}), 404

    # 先後決定
    first = match.get("first", "main")
    if swap_first:
        first = "sub" if first == "main" else "main"

    # 初期盤（python-shogi の Board）
    new_board = shogi.Board()

    # ★ 終局系とリセット系を完全クリア
    match_states[key] = {
        **match,
        "first": first,
        "board": new_board,
        "kifu": [],
        "captured": {"main": [], "sub": []},
        "winner": None,
        "resigner": None,
        "reason": None,           # ← 重要：resign を確実に消す
        "result": None,           # 使っているなら消す
        "finished": False,        # 終局フラグも下ろす

        "reset_requested": False,
        "reset_accepted": False,
        "resetting": False,
        "last_comment": "",
        "reset_epoch": match.get("reset_epoch", 0) + 1,
    }
    return jsonify({"ok": True, "first": first, "reset_epoch": match_states[key]["reset_epoch"]})

def restore_last_move_if_needed(key):
    match = match_states.get(key)
    if match and not match.get("kifu") and match.get("last_move_backup"):
        match["kifu"] = [match["last_move_backup"]]
        match.pop("last_move_backup", None)

@app.post("/undo_last_move")
def undo_last_move():
    data = request.get_json(force=True) or {}
    main = data.get("main"); sub = data.get("sub"); role = data.get("role")
    key = (main, sub)
    match = match_states.get(key)
    if not match:
        return jsonify({"status":"error","message":"対局が存在しません"}), 404

    board = match.get("board")
    if not isinstance(board, shogi.Board):
        return jsonify({"status":"error","message":"盤が初期化されていません"}), 400

    kifu = match.setdefault("kifu", [])
    if not kifu or not board.move_stack:
        return jsonify({"status":"error","message":"これ以上戻せません"}), 400

    last = kifu[-1]
    last_by = last.get("by")  # "main" / "sub"
    if last_by != role:
        return jsonify({"status":"error","message":"直前の手を指した側のみ取り消せます"}), 403

    # ---- 1手戻す ----
    kifu.pop()
    board.pop()

    # ---- ★ サーバ内部状態を必ず更新（これが最重要） ----
    match["board"] = board
    match["board_matrix"] = board_to_matrix(board)

    # 終局フラグをクリア
    match["winner"]   = None
    match["reason"]   = None
    match["finished"] = False
    match["resigner"] = None

    # 持ち駒を再計算
    match["captured"] = get_captured_pieces(board, main, sub)

    # 次手番（first基準）
    first = match.get("first", "main")
    black_role = first
    white_role = "sub" if first == "main" else "main"
    turn_role = black_role if board.turn == shogi.BLACK else white_role
    match["turn_role"] = turn_role

    return jsonify({
        "status":   "undo",
        "board":    match["board_matrix"],
        "captured": match["captured"],
        "kifu_len": len(kifu),
        "turn":     turn_role,
        "first":    first,
        "finished": False,
        "reason":   None,
        "last_by":  kifu[-1]["by"] if kifu else None,
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)


