# SHOGI_NET – インストール手順（Windows 日本語版）

このドキュメントは、Windows 上で **SHOGI_NET** をインストール・起動する手順を説明します。  
サーバーは Python + Flask で動作し、クライアントは Chrome からアクセスします。

---

# 1. 動作環境

### ハードウェア
- Windows PC（デスクトップ / ノート）

### ソフトウェア
- Windows 10 / 11
- Python 3.10 系（推奨）
- Google Chrome（最新版）
- Git（公式インストーラでインストール）

---

# 2. Python のインストール（未インストールの場合）

以下のページから Windows 用 Python をダウンロードします：  
```text
https://www.python.org/downloads/windows/
```

### インストール時の注意点（重要）

インストール画面の最初にある：

☑ **Add python.exe to PATH**

に必ずチェックを入れてください。  
これを忘れると、コマンドプロンプトで python が使えません。  

インストール後、バージョン確認：

```powershell
python --version
```

# 3. SHOGI_NET リポジトリのクローン
作業したいフォルダ（例：デスクトップ）を開き、
Shift + 右クリック → 「PowerShell ウィンドウをここで開く」 を選択します。

次のコマンドを入力します：

```powershell
git clone https://github.com/Hiroshi-Maeda-Donau/SHOGI_NET.git
cd SHOGI_NET
```

# 4. 仮想環境（venv）の作成
Windows 版では、仮想環境の名前は venv とします。

```powershell
python -m venv venv
```
作成した仮想環境を有効化します：

```powershell
.\venv\Scripts\activate
```
ターミナルの先頭が次のように変われば成功です：

```text
(venv) C:\Users\YourName\Desktop\SHOGI_NET>
```
仮想環境を終了したいときは：

```powershell
deactivate
```

# 5. 必要な Python パッケージのインストール
仮想環境（(venv)）が有効になっている状態で、requirements.txt を使ってライブラリをインストールします：

```powershell
pip install -r requirements.txt
```
これにより、以下のようなパッケージがインストールされます：  
```
- Flask

- python-shogi

- numpy

- keras / tensorflow（含まれていれば）

- その他必要な依存パッケージ  
```

# 6. Flask サーバーの起動
SHOGI_NET フォルダ内で次を実行します：

```powershell
python shogi_main.py
```
正常に起動すると、コマンドプロンプトに次のような表示が出ます：

```text
 * Running on http://127.0.0.1:5000
```


# 7. ブラウザからゲーム画面にアクセス
Google Chrome を開き、次の URL にアクセスします：

```text
http://localhost:5000
```
正常であれば以下の画面が表示されます：
```
- ログインID登録

- 対人対局（PVP）：メインとサブ

- AI 対局

- 棋譜再生

- AIの学習  
```


# 8. LAN 内の別 PC から対人対局（PVP）を行う場合
同一 LAN 上の別 PC（Windows / Mac）から接続する場合の手順です。

### 1) サーバーが稼働しているWindows PC の IP アドレス確認
PowerShell で次のコマンドを実行：

```powershell
ipconfig
```
表示例：

```text
IPv4 アドレス . . . . . . . . . : 192.168.0.23
```

### 2) 別 PC から接続
別 PC の Chrome で次の URL を入力：

```text
http://192.168.0.23:5000
```
これで複数PCから SHOGI_NET にアクセスできます。  
```

- メインID / サブID を登録

- マッチング

- 対人対局の開始  
```


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
Windows は基本的に大文字・小文字を区別しませんが、
フォルダ名を変えたり、移動したりしないようにしてください。

# 10. プロジェクトの更新
GitHub 上のリポジトリが更新された場合は、次のコマンドで最新状態を取得します：

```powershell
git pull
```
依存パッケージが更新されたら再インストール：

```powershell
pip install -r requirements.txt
```

# 11. トラブルシューティング
❗ Flask サーバーが起動しない
仮想環境が有効になっていない可能性があります。

```powershell
.\venv\Scripts\activate
python shogi_main.py
```

❗ 別 PC からアクセスできない場合
原因として考えられるもの：

- Windows のファイアウォールが通信をブロック

対処：

設定

- プライバシーとセキュリティ → Windows セキュリティ

- ファイアウォールとネットワーク保護

- アプリにファイアウォールを通過させる

- python.exe を許可

❗ ポート 5000 が使用中
確認：

```powershell
netstat -ano | findstr :5000
```
プロセス終了：

```powershell
taskkill /PID <PID> /F
```

# 12. アンインストール（削除方法）
SHOGI_NET 関連はすべてフォルダ内に収まっています。  
不要になった場合はフォルダごと削除すれば完了です。  

```powershell
rd /s /q SHOGI_NET
```

（例：デスクトップにある場合）

```powershell
rd /s /q C:\Users\YourName\Desktop\SHOGI_NET  
```

## 🙆‍♂️ これで、Windows 上で SHOGI_NET を動作させる準備が整いました。
## ローカル対局、LAN 対局、AI 対局をお楽しみください。

