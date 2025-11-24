# learn/apply_usi.py
from copy import deepcopy
from .sfen_action import sfen_to_index
from .constants import DROP_ORDER

PROMOTE_MAP = {"P":"+P", "L":"+L", "N":"+N", "S":"+S", "B":"+B", "R":"+R"}
DEMOTE_MAP  = {"+P":"P", "+L":"L", "+N":"N", "+S":"S", "+B":"B", "+R":"R"}

def _place_code_for_side(base: str, side: str, promoted: bool) -> str:
    """base は大文字（P,L,...）。side='sente'/'gote'。goteは小文字。成りは '+x' 形式。"""
    if promoted:
        code = "+" + base
    else:
        code = base
    if side == "gote":
        # 後手は小文字（成駒は '+p' のように末尾が小文字になる）
        if code.startswith("+"):
            return "+" + code[1].lower()
        return code.lower()
    # 先手は大文字
    return code

def _get_base_upper(code: str) -> str:
    """盤面コード（'P','p','+P','+p'）から、ベースの大文字（'P'など）を返す"""
    ch = code[-1]  # 最後の文字が駒字
    return ch.upper()

def apply_usi(board_2d, hands, side_to_move, usi):
    """
    board_2d: 9x9 文字（大=先, 小=後, 成駒は '+P' or '+p'）
    hands: {"sente":{P:int,...}, "gote":{P:int,...}}  # 鍵は常に大文字の駒種
    usi: "7g7f", "2b3c+", "P*5e"
    戻り値: (new_board, new_hands, next_side)
    """
    board = deepcopy(board_2d)
    hands2 = {k: {kk: int(vv) for kk, vv in v.items()} for k, v in hands.items()}
    cur  = side_to_move
    next_side = "gote" if cur == "sente" else "sente"

    # 打ち駒
    if "*" in usi:
        pc, to_sfen = usi.split("*")
        to = sfen_to_index(to_sfen)
        tr, tc = divmod(to, 9)
        # 置く
        board[tr][tc] = _place_code_for_side(pc, cur, promoted=False)
        # 手駒を減らす（手駒キーは大文字）
        hands2.setdefault(cur, {})
        hands2[cur][pc] = max(0, hands2[cur].get(pc, 0) - 1)
        return board, hands2, next_side

    # 盤上の移動（成りあり）
    frm_sfen, to_sfen = usi[:2], usi[2:4]
    promote = (len(usi) == 5 and usi[-1] == "+")
    fr = sfen_to_index(frm_sfen); tr = sfen_to_index(to_sfen)
    fr_r, fr_c = divmod(fr, 9)
    to_r, to_c = divmod(tr, 9)

    moving = board[fr_r][fr_c]
    if not moving:
        # 異常系は無視して手番だけ進める
        return board, hands2, next_side

    # 取り（相手駒がいたら手駒へ：成駒は不成に戻す）
    captured = board[to_r][to_c]
    if captured:
        base = _get_base_upper(captured)      # 大文字
        # 成駒は不成に戻す (+P -> P)
        # base は既に不成の大文字なのでそのまま数える
        hands2.setdefault(cur, {})
        hands2[cur][base] = hands2[cur].get(base, 0) + 1

    # 移動元を空に
    board[fr_r][fr_c] = ""

    # 動かす駒のベース（大文字）
    base = _get_base_upper(moving)
    # 成りの確定（G/Kは成れない）
    will_promote = promote and (base in PROMOTE_MAP)

    # 置き先コードを作って配置
    board[to_r][to_c] = _place_code_for_side(base, cur, promoted=will_promote)

    return board, hands2, next_side

