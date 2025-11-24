import json
import numpy as np
from sfen_to_array import sfen_to_array
from convert_move_to_label import move_to_label, USI_TO_LABEL
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Conv2D, Flatten, Dense
from tensorflow.keras.utils import to_categorical

# --------------------------
# パラメータ設定
INPUT_SHAPE = (18, 9, 9)     # 入力データ形状
NUM_CLASSES = len(USI_TO_LABEL)
EPOCHS = 10
BATCH_SIZE = 4
# --------------------------

# データ読み込み
with open("data/train_data.json", encoding="utf-8") as f:
    data = json.load(f)

X = []
y = []

for item in data:
    board_array = sfen_to_array(item["board_sfen"])
    label = move_to_label(item["move_usi"])
    if label == -1:
        continue  # 未知の指し手は除外
    X.append(board_array)
    y.append(label)

X = np.array(X)
# (batch, 18, 9, 9) → (batch, 9, 9, 18) に変換
X = np.transpose(X, (0, 2, 3, 1))
y = to_categorical(y, num_classes=NUM_CLASSES)

print("✅ データ読み込み完了:", X.shape, y.shape)

# モデル構築（簡易CNN）
model = Sequential([
    Conv2D(32, kernel_size=3, activation='relu', input_shape=(9, 9, 18)),
    Flatten(),
    Dense(256, activation='relu'),
    Dense(NUM_CLASSES, activation='softmax')
])

model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])

print("🏋️‍♀️ 学習開始...")
model.fit(X, y, epochs=EPOCHS, batch_size=BATCH_SIZE)

# モデル保存
model.save("shogi_model.h5")
print("✅ モデル保存完了: shogi_model.h5")

