# learn/utils.py
def initial_board_2d():
    """
    先手: 大文字, 後手: 小文字, 成りなし
    左から 9..1 列（USIの列番号に合わせて「1が右端」なので配列はそのままでOK）
    """
    row0 = list("lnsgkgsnl")   # 後手 1段目
    row1 = ["", "r", "", "", "", "", "", "b", ""]
    row2 = ["p"] * 9
    row6 = ["P"] * 9
    row7 = ["", "B", "", "", "", "", "", "R", ""]
    row8 = list("LNSGKGSNL")   # 先手 1段目

    def up(s):  return s.upper()
    def low(s): return s.lower()

    board = [
        [*row0],                       # 0:  a段
        [*row1],                       # 1:  b段
        [*row2],                       # 2:  c段
        [""]*9,                        # 3:  d
        [""]*9,                        # 4:  e
        [""]*9,                        # 5:  f
        [*row6],                       # 6:  g
        [*row7],                       # 7:  h
        [*row8],                       # 8:  i
    ]
    return board
