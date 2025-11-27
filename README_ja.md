# SHOGI_NET（日本語版）

SHOGI_NET は、ブラウザで動作する将棋ゲームです。  
対人対局（LAN 内）、AI 対局、棋譜保存・再生に対応しており、  
サーバー PC（Mac / Windows）に Flask を起動し、  
クライアント PC は Chrome からアクセスする構成を採用しています。

---

## 特長

### 🧑‍🤝‍🧑 **対人対局（Human vs Human）**
- メインID／サブIDを用いたマッチング方式  
- 同一LAN内の別PCからアクセス可能  
- 自分の画面では自分の駒が手前に表示され、相手側は反転された向きで表示  
- サーバー側の `match_states` に対局情報を保持し、  
  クライアントでは数秒おきのポーリングで盤面を同期  
- リセットリクエストの仕組み導入　メイン側：リセット要求→サブ側：承諾

### 🤖 **AI対局（Human vs AI）**
- 先手／後手を選択可能  
- Simple AI、Minimax AI、Learning AI などの複数エンジンに対応できる設計  
- AI の指し手はサーバー側で計算し、クライアント画面へ即時反映

### 📜 **棋譜保存・再生**
- 全ての対局（PVP／AI）は自動的に JSON 形式の棋譜に保存  
- 保存場所は以下の通り：
```
    kifu/pvp/ … 人間同士の棋譜
    kifu/ai/ … AI対局の棋譜
    kifu/pvp_flip/ … 反転棋譜（先手・後手入れ替え）
    kifu/registry/ … seen_games.json などのレジストリ
```

- 棋譜再生画面では以下の操作が可能
```  
    - 最初の手に戻る  
    - 一手戻る  
    - 一手進む  
    - 自動再生  
    - 停止  
    - 対局画面に戻る  
```

### 💾 **AI モデル・学習データの管理**
- `models/` … AIモデル（.h5 / .keras）を配置  
- `snapshots/` … 学習途中のスナップショットを保存  
- `learn/` … flip処理・データ整形・学習スクリプトなど  
- ※ AI 学習の詳細は別途進行中

### 🌐 **ローカルネットワーク運用**
- サーバーを Mac／Windows で起動し、  
LAN 内の別PCから `http://<サーバーIP>:5000` にアクセスする方式  
- 社内利用や家庭内 LAN 対戦に適した構成

---

## システム構成概要

### 📌 サーバー側（Python / Flask）
- Python 3.10 系を推奨  
- Flask による Web API  
- 役割：  
- 対局状態の保存  
- 盤面同期用データの返却  
- AI の思考処理  
- 棋譜・学習データの保存  
- マッチング（メインID／サブID）の管理  
- レジストリ管理（match_states / game_states）

### 📌 クライアント側（HTML / JavaScript）
- Google Chrome 推奨  
- HTML / CSS / JavaScript による将棋 UI  
- JavaScript による指し手入力、アニメーション、盤面同期処理  
- ローカル PC（Windows/Mac）からブラウザ経由で直接操作

---

## ディレクトリ構成（概要）

```text
SHOGI_NET/
├ README_en.md          # 英語版 README
├ README_ja.md          # 本ファイル（日本語版 README）
├ INSTALL_en_mac.md     # インストール手順（Mac用：英語）
├ INSTALL_ja_mac.md     # インストール手順（Mac用：日本語）
├ INSTALL_en_win.md     # インストール手順（Windows用：英語）
├ INSTALL_ja_win.md     # インストール手順（Windows用：日本語）
├ requirements.txt      # Python パッケージ一覧
├ shogi_main.py         # Flask サーバー（エントリポイント）
├ static/
│   └ js/               # 将棋ロジック・UI 制御 JS
├ templates/            # HTMLテンプレート
├ kifu/
│   ├ ai/
│   ├ pvp/
│   ├ pvp_flip/
│   └ registry/         # 棋譜レジストリ（seen_games.json 等）
├ models/               # AIモデル（.h5 / .keras）
├ snapshots/            # 対局中断、再開用スナップショット
├ learn/                # 学習スクリプト・データ補助
├ utils/                # 補助スクリプト
└ .gitignore            # Git 除外設定
```
## 動作環境  

**サーバーOS**    

- macOS

- Windows 11

**クライアント**

- Google Chrome

- Python（3.10 系推奨：3.x で動作可能）

## 起動手順（簡易版）  
詳細は INSTALL_ja.md を参照してください。
ここでは簡単な流れだけ記載します。

**クローン**

```bash
コードをコピーする
git clone https://github.com/Hiroshi-Maeda-Donau/SHOGI_NET.git
cd SHOGI_NET  
```
**仮想環境作成**  

```bash
コードをコピーする
python -m venv venv
source venv/bin/activate   # Windows は .\venv\Scripts\activate
```
**パッケージインストール**

```bash
コードをコピーする
pip install -r requirements.txt  
```

**Flask 起動**

```bash
コードをコピーする
python shogi_main.py
```

**ブラウザでアクセス**

```arduino
コードをコピーする
http://localhost:5000  
```

## ⭕️ 棋譜データについて（著作権）  

### 保存される棋譜データは
```  
- 自分で対局したもの、または公表されている棋譜を“自分で盤面再現して入力したもの”です。  

- 棋譜（指し手）は「事実の記録」であり著作権の対象ではありません。  

- 解説文・図面などの転載は行っていません。  

- 有料アプリや書籍の棋譜ファイルをそのままコピーすることはありません。
```

## 今後の予定  
```
- 対人対局機能の安定化

- AIの強化（learning AI の導入）

- UIの改良

- 棋譜管理機能の拡張

- 多言語 README（ドイツ語版…？）の追加予定？
```

## 作者  
```
開発者: Hiroshi Maeda

開発環境: macOS / Python / Flask / JavaScript

趣味と研究を兼ねた個人プロジェクトとして開発中  
```

