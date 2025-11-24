# 駒14種（未成+成）を先後で分けて28面にする方針
PIECES = ["P","L","N","S","G","B","R","K","+P","+L","+N","+S","+B","+R"]
PIECE2IDX = {p: i for i, p in enumerate(PIECES)}  # 0..13

# 打ち駒に使う7種の順序
DROP_ORDER = ["P","L","N","S","G","B","R"]
DROP2IDX = {p: i for i, p in enumerate(DROP_ORDER)}

# 手駒の最大枚数（正規化用）
MAX_HAND = {"P":18, "L":4, "N":4, "S":4, "G":4, "B":2, "R":2}

# アクション空間（from×to×promote + drop）
NUM_FROM = 81
NUM_TO = 81
NUM_PROM = 2
BASE_MOVE = NUM_FROM * NUM_TO * NUM_PROM   # 13122
NUM_ACTIONS = BASE_MOVE + len(DROP_ORDER) * 81  # 13689

FILE_LET = "abcdefghi"  # SFENの列文字

