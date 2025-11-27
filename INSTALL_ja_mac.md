# SHOGI_NET – インストール手順（macOS 日本語版）

このドキュメントは、macOS 上で **SHOGI_NET** をインストール・起動する手順を説明します。  
サーバーは Python + Flask で動作し、クライアントは Chrome からアクセスします。

---

# 1. 動作環境

### ハードウェア
- MacBook / iMac / Mac mini （Intel / Apple Silicon いずれも可）

### ソフトウェア
- macOS 12 以降を推奨
- Python 3.10 系（推奨）
- Google Chrome（最新版）
- Git（Homebrew または公式インストーラでインストール）

---

# 2. Python のインストール（未インストールの場合）

macOS には古い Python が入っていることが多いため、  
Homebrew または python.org から新しい Python を入れることをおすすめします。

### 方法 A：Homebrew からインストール（推奨）

```bash
brew install python@3.10
```
### 方法 B：python.org からインストール
以下からダウンロードします：  
```
https://www.python.org/downloads/macos/  
```

インストール時に、可能であれば次の項目を確認してください：

✔ 「Add python to PATH」にチェック（表示される場合）

インストール後、バージョンを確認します：

```bash
python3 --version  
```

# 3. SHOGI_NET リポジトリのクローン
作業したいフォルダ（例：デスクトップ）に移動して、GitHub からクローンします。  

```bash
cd ~/Desktop
git clone https://github.com/Hiroshi-Maeda-Donau/SHOGI_NET.git
cd SHOGI_NET  
```

# 4. 仮想環境（venv310）の作成
macOS では、SHOGI_NET 用に専用の仮想環境 venv310 を作成します。  

```bash
python3 -m venv venv310
```
作成した仮想環境を有効化します：

```bash
source venv310/bin/activate  
```
ターミナルの先頭が次のように変われば成功です：

```text
(venv310) yourname@Mac …
```
仮想環境を終了したいときは：

```bash
deactivate  
```

# 5. 必要な Python パッケージのインストール
仮想環境（(venv310)）が有効になっている状態で、requirements.txt を使ってライブラリをインストールします。

```bash
pip install -r requirements.txt
```
これにより、以下のようなパッケージがインストールされます：

- Flask

- python-shogi

- numpy

- モデル読み込み用ライブラリ（keras / tensorflow など、含まれていれば）

- その他必要な依存パッケージ

# 6. Flask サーバーの起動
SHOGI_NET フォルダ内で、以下を実行します。

```bash
python shogi_main.py
```
正常に起動すると、ターミナルに次のような表示が出ます：

```text
 * Running on http://127.0.0.1:5000
```

# 7. ブラウザからゲーム画面にアクセス
Google Chrome を開いて、次の URL にアクセスします：

```text
http://localhost:5000
```
正常であれば、以下のような画面が表示されます：

- ログインID登録

- 対人対局（PVP）：メインとサブ

- AI 対局

- 棋譜再生

- AIの学習

# 8. LAN 内の別 PC から対人対局（PVP）を行う場合
同一 LAN 上の別 PC（Windows / Mac）から接続する場合は、
サーバーになっている Mac のローカル IP アドレスを確認します。  

## 1) Mac の IP アドレス確認
```bash
ifconfig | grep inet
```
例として、次のようなアドレスが表示されます：

```text
192.168.0.14
```
## 2) 別 PC から接続
別 PC の Chrome で次のように入力します：

```text
http://192.168.0.14:5000
```
これで、両方の PC から SHOGI_NET の画面にアクセスできるようになります。

- メインID / サブID を登録

- マッチング

- 対人対局の開始

などが可能になります。

# 9. 棋譜・AI モデル用フォルダについて
リポジトリには、以下のフォルダが含まれていることを前提としています：

```text
kifu/
  ai/
  pvp/
  pvp_flip/
  registry/
models/
snapshots/  
```
macOS ではパスの大文字・小文字が区別される場合があります。
フォルダ名を変更したり、別の場所に移動したりしないでください。

# 10. プロジェクトの更新
GitHub 上のリポジトリが更新された場合は、次のコマンドで最新状態を取得します。

```bash
git pull
```
依存パッケージ（requirements.txt）が更新された場合は、再度インストールします：

```bash
pip install -r requirements.txt
```
# 11. トラブルシューティング
❗ Flask サーバーが起動しない
原因として多いのは、仮想環境が有効になっていないケースです。

```bash
source venv310/bin/activate
python shogi_main.py
```
の順に実行してみてください。

❗ 別 PC からブラウザで接続できない
考えられる原因：

- Mac のファイアウォールが通信をブロックしている

対処：

- 「システム設定」または「システム環境設定」

- セキュリティとプライバシー → ファイアウォール → ファイアウォールオプション

- Python / Flask（またはターミナル）による受信接続を許可

❗ ポート 5000 がすでに使用中と言われる
他の Flask サーバーなどが 5000 番ポートを使用している可能性があります。

- 使用しているプロセスを確認：

```bash
lsof -i :5000
```
表示された PID を指定してプロセスを終了：

```bash
kill -9 <PID>
```

# 12. アンインストール（削除方法）
SHOGI_NET 関連の環境は、基本的に SHOGI_NET フォルダ内に閉じています。
不要になった場合は、フォルダごと削除すれば完了です。

```bash
rm -rf ~/Desktop/SHOGI_NET
```
※ 他の場所にクローンした場合は、そのパスに応じて読み替えてください。

## 🙆‍♂️これで、macOS 上で SHOGI_NET を動かすための準備は完了です。
## ローカル対局や LAN 内の対人対局、AI 対局をお楽しみください。

