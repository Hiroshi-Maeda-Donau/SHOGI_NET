# learn/sfen_action.py
from .constants import FILE_LET, DROP_ORDER, DROP2IDX, BASE_MOVE

def sfen_to_index(s: str) -> int:
    f = int(s[0]) - 1
    r = FILE_LET.index(s[1])
    return r * 9 + f

def index_to_sfen(idx: int) -> str:
    r, f = divmod(idx, 9)
    return f"{f+1}{FILE_LET[r]}"

def usi_to_action_id(usi: str) -> int:
    # 盤上移動: "7g7f" or "2b3c+"
    if "*" not in usi:
        frm, to = usi[:2], usi[2:4]
        prom = 1 if len(usi) == 5 and usi[-1] == "+" else 0
        f = sfen_to_index(frm); t = sfen_to_index(to)
        return ((f * 81) + t) * 2 + prom
    # 打ち駒: "P*5e"
    pc, to = usi.split("*")
    t = sfen_to_index(to)
    return BASE_MOVE + DROP2IDX[pc] * 81 + t

def action_id_to_usi(aid: int) -> str:
    if aid < BASE_MOVE:
        prom = aid % 2
        rest = aid // 2
        t = rest % 81
        f = rest // 81
        return f"{index_to_sfen(f)}{index_to_sfen(t)}" + ("+" if prom else "")
    rel = aid - BASE_MOVE
    pidx, t = divmod(rel, 81)
    pc = DROP_ORDER[pidx]
    return f"{pc}*{index_to_sfen(t)}"

