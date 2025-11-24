# train.py
import argparse, shutil
from pathlib import Path
import json
import numpy as np
from tensorflow import keras

from .dataset import (
    load_two_folders,
    mark_fingerprints,
    wipe_fingerprints,
)

from .model import build_model

# ---------- registry I/O ----------
def _load_registry_set(path: str | None) -> set[str]:
    if not path: return set()
    p = Path(path)
    if not p.exists(): return set()
    try:
        arr = json.loads(p.read_text(encoding="utf-8"))
        return set(x for x in arr if isinstance(x, str))
    except Exception:
        return set()

def _save_registry(path: str, s: set[str]):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(sorted(s), ensure_ascii=False, indent=2), encoding="utf-8")

def _update_registry_with_marks(reg_path: str, mark_list: list[tuple[str, str]]):
    s = _load_registry_set(reg_path)
    before = len(s)
    s.update(fp for (_path, fp) in mark_list)
    _save_registry(reg_path, s)
    print(f"📝 registry updated: {reg_path} (+{len(s)-before}, total={len(s)})")

# ---------- main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folder", default="kifu/pvp")
    ap.add_argument("--extra-folder", default="kifu/pvp_flip",
                    help="追加学習フォルダ（反転棋譜など）")
    ap.add_argument("--finished-only", action="store_true", default=False,
                     help="終局フラグのある棋譜だけ学習に使う（付けた時だけ有効）")
    # 正式名で統一
    ap.add_argument("--registry", default="kifu/registry/main.json",
                    help="通常棋譜の既学習指紋の保存先")
    ap.add_argument("--extra-registry", default="kifu/registry/flip.json",
                    help="反転棋譜の既学習指紋の保存先")

    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--ch", type=int, default=64)
    ap.add_argument("--blocks", type=int, default=8)
    ap.add_argument("--verbose", type=int, default=1)
    ap.add_argument("--write-fingerprints", action="store_true", default=True,
                    help="学習成功後に棋譜JSONへfingerprintを書き戻す")
    ap.add_argument("--full-retrain", action="store_true", default=False,
                    help="registryを無視して全件を学習に含める（全再学習）")
    ap.add_argument("--wipe-fingerprints", action="store_true", default=False,
                    help="全再学習の前に pvp/pvp_flip の全棋譜から 'fingerprint' を削除する")                
    args = ap.parse_args()

    # ---- データ読み込み（registryで未学習のみ選別）----
    #print(f"📦 load: {args.folder} (+ {args.extra_folder})")
    # --- 全再学習で fingerprint を消すオプション ---
    if args.full_retrain and args.wipe_fingerprints:
        wipe_fingerprints([args.folder] + ([args.extra_folder] if args.extra_folder else []))

    print(f"📦 load: {args.folder} (+ {args.extra_folder})")
    X, y, marks = load_two_folders(
        folder_a=args.folder,
        folder_b=args.extra_folder,
        finished_only=args.finished_only,
        registry_a=args.registry,
        registry_b=args.extra_registry,
        #collect_mark_list=True,
        collect_mark_list=True,
        # 全再学習なら未学習スキップを無効化
        #only_unfingerprinted=not args.full_retrain,
        only_unfingerprinted=not args.full_retrain,  # 全再学習なら registry を無視
    )
    print(f"📚 dataset: X={X.shape}, y={y.shape}, marks={len(marks)}")

    # ---- モデル構築・学習 ----
    #model = build_model(ch=args.ch, blocks=args.blocks, C=X.shape[-1])
    model = build_model(ch=args.ch, blocks=args.blocks, C=X.shape[-1])
    # --- 追加: Top-k 指標＋clipnorm ---
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=1e-3, clipnorm=1.0),
        loss="sparse_categorical_crossentropy",
        metrics=[
            "sparse_categorical_accuracy",                          # ← 明示
            keras.metrics.SparseTopKCategoricalAccuracy(k=5,  name="top5_acc"),  # ← こちらを使用
            keras.metrics.SparseTopKCategoricalAccuracy(k=10, name="top10_acc"),
        ],
    )

    callbacks = [
        keras.callbacks.ModelCheckpoint(
            "models/shogi_policy_best.keras",
            monitor="val_top5_acc",   # ← 上で name="top5_acc" にしたのでこのままでOK
            save_best_only=True
        ),
        keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5,
                                          patience=2, min_lr=1e-5, verbose=1),
        keras.callbacks.EarlyStopping(monitor="val_loss", patience=5,
                                      restore_best_weights=True),
    ]

    model.fit(
        X, y,
        epochs=args.epochs,
        batch_size=args.batch,
        shuffle=True,
        validation_split=0.1,
        callbacks=callbacks,
        verbose=args.verbose,
    )

    # ---- 保存 ----
    Path("models").mkdir(parents=True, exist_ok=True)
    model.save("models/shogi_policy.keras")
    print("✅ 保存: models/shogi_policy.keras")
    if Path("models/shogi_policy_best.keras").exists():
        shutil.copy("models/shogi_policy_best.keras", "models/shogi_policy.keras")
        print("📦 Copied best → models/shogi_policy.keras")
    else:
        print("⚠️ models/shogi_policy_best.keras が見つかりませんでした")

    # ---- 成功後：registry更新＋棋譜へfp書き戻し ----
    # pvp と pvp_flip をマーク分割
    marks_pvp      = [(p, fp) for (p, fp) in marks if "/pvp/"      in p or "\\pvp\\"      in p]
    marks_pvp_flip = [(p, fp) for (p, fp) in marks if "/pvp_flip/" in p or "\\pvp_flip\\" in p]

    _update_registry_with_marks(args.registry,       marks_pvp)
    _update_registry_with_marks(args.extra_registry, marks_pvp_flip)

    if args.write_fingerprints and marks:
        print("🖊️ writing fingerprints into kifu files...")
        mark_fingerprints(marks)
        print("✅ fingerprints written")

if __name__ == "__main__":
    main()
