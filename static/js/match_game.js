// match_game.js

// ✅ DOM読み込みを待ってから処理開始

document.addEventListener("DOMContentLoaded", () => {
  console.log("✅ match_game.js が正しく読み込まれました 2025.8.12,15:27");

  // 盤のルート要素（例）
  const boardEl = document.querySelector('.board');
  boardEl?.addEventListener('mousedown', () => boardEl.classList.add('dragging'));
  window.addEventListener('mouseup', () => {
    if (boardEl) boardEl.classList.remove('dragging');
  });

  const resetBtn = document.getElementById("accept-reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", acceptReset);
  }
  //console.log("🟠gameMode=", gameMode);

  // 🔽 id="gameMode" が存在する場合のみ、textContent を更新
  const gameModeElement = document.getElementById("gameMode");
  if (gameModeElement) {
    gameModeElement.textContent = "match";
  } else {
    console.log("gameMode = match");  // UIに表示要素がなければログに出す
  }
  
  const userId = localStorage.getItem("userId");
  if (userId) {
    document.getElementById("login-id-display").textContent = userId;
  }

  // HTML要素取得と変数初期化
  // ✅ URLパラメータを取得して状態管理する
  const urlParams = new URLSearchParams(window.location.search);
  const role = urlParams.get("role");
  const mainId = urlParams.get("main_id");
  const subId = urlParams.get("sub_id");
  const first = urlParams.get("first");
  const playerId = urlParams.get("player_id");
  const gameMode = "match"; // 明示的に変数として保持

  let selectedCell2 = null;
  let isMyTurn = false;
  let funcFrom = "";
  let funcFrom2 = "";
  let pollingIntervalId = null;
  let pollingStarted = false;
  let selectedHandPiece = null; // 駒台から選ばれた駒（打ち込み用）
  let isResetRequesting = false;
  let pollingActive = true;
  let pollFirstMoveTimer = null;  // グローバルで定義することで明確に管理
  let currentKifu = [];  // クライアント側の棋譜の長さを管理
  let hasShownResetRequest = false;
  let pollTimer = null;
  let firstMoveMode = false;
  let pollCounter = 0;
  let lastOpponentComment = null;
  //let isResetting = false;
  let acceptedByMe = false;
  let opponentId = "";
  let firstPlayer = first; // "main" または "sub"
  let gameOver = false;  // 終局フラグ
  let postGameTimer = null;
  let inPostGame = false;   // ← 終局モード中フラグ
  let seenResetEpoch = null; // ← サーバが reset_epoch を返すなら使う
  let uiDisabled = false;

  // for debug
  let fromWhere = "";

  // （どこか起動時に一度だけ）
  //window.isResetting ??= false;

  const boardElement = document.getElementById("board");
  
  // 将棋の駒表記変換
  const usiToKanji = {
    P: "歩", L: "香", N: "桂", S: "銀", G: "金",
    B: "角", R: "飛", K: "玉",
    "+P": "と", "+L": "杏", "+N": "圭", "+S": "全", "+B": "馬", "+R": "竜"
  };
  const promotedChars = ["と", "杏", "圭", "全", "馬", "竜"];

  //const boardElement = document.getElementById("board");
  const rightPanel = document.getElementById("right-panel");

  // match_game.js の先頭付近で定義
  const isSubView = (role === "sub");

  if (!boardElement || !rightPanel) {
    console.error("盤面または右パネルが見つかりません。");
    return;
  }

  if (role === "main") {
    opponentId = subId;
    console.log("🟢opponentID=", opponentId);
    showMatchPanelAsMain(opponentId, firstPlayer);
  } else if (role === "sub") {
    opponentId = mainId;
    console.log("🟢opponentID=", opponentId);
    showMatchPanelAsSub(opponentId, firstPlayer);
 
  } else {
    console.warn("未対応のroleです：", role);
  }

  console.log("🔴drawEmptyBoard2");
  console.log("🎮 match_game.js 開始");
  console.log("🟢 role =", role);
  console.log("🟢 playerID =", playerID);
  console.log("🟢 opponentID =", opponentID);
  console.log("🟢 first =", first);

  drawEmptyBoard2();

  if (role === "sub") {
    console.log("🔴waitForGameStart");
    waitForGameStart();
  }

  function initGlobal() {
    isMyTurn = false;
    funcFrom = "";
    funcFrom2 = "";
    pollingIntervalId = null;
    pollingStarted = false;
    selectedHandPiece = null; // 駒台から選ばれた駒（打ち込み用）
    isResetRequesting = false;
    pollingActive = true;
    pollFirstMoveTimer = null;  // グローバルで定義することで明確に管理
    currentKifu = [];  // クライアント側の棋譜の長さを管理
    hasShownResetRequest = false;
    pollTimer = null;
    firstMoveMode = false;
    pollCounter = 0;
    lastOpponentComment = null;
    acceptedByMe = false;
    opponentId = "";
    firstPlayer = first; // "main" または "sub"
    gameOver = false;
    inPostGame = false;   // ← 終局モード中フラグ
    seenResetEpoch = null; // ← サーバが reset_epoch を返すなら使う
    uiDisabled = false;


    // for debug
    fromWhere = "";

  }

  // 盤要素を毎回取り直す
  function getBoardEl() {
    return document.getElementById("board"); // ←実際の盤IDに合わせて
  }

  // マウスアップで drag クラスを必ず外す（名前付きで）
  function onWindowMouseUp() {
    const el = getBoardEl();
    if (el) el.classList.remove("dragging");
  }

  // 二重登録を避けてから張り直す
  function bindGlobalBoardHandlers() {
    window.removeEventListener("mouseup", onWindowMouseUp);
    window.addEventListener("mouseup", onWindowMouseUp);
  }

  // クリックハンドラは名前付きで
  async function onClickUndo(ev) {
    ev?.preventDefault?.();
    // ここは既存の「一手戻る」処理を呼ぶ
    await undoLastMove();
  }

  // 共通ボタン用に一本化（メイン/サブで同じID）
  function undoBtnIdForRole() { return "btn-undo"; }

  async function onClickUndo(ev) {
    ev?.preventDefault?.();
    await undoLastMove();  // ← 既存のサーバ通信関数
  }

  function afterUiRedrawHooks() {
    // --- 盤のイベント再バインド（board要素は再生成されている想定） ---
    const boardEl = document.getElementById("board"); // ← あなたのDOMに合わせる
    if (boardEl) {
      // 古い drag ステートを掃除
      boardEl.classList.remove("dragging");
      // 必要なら再バインド
      boardEl.addEventListener("mousedown", () => boardEl.classList.add("dragging"), { passive: true });
      window.addEventListener("mouseup", () => boardEl.classList.remove("dragging"));
      // ほか、セルクリックのデリゲーションなどがあればここで再登録
    }

    // --- Undo ボタンの再バインド ---
    const undoBtn = document.getElementById("btn-undo");
    if (undoBtn) {
      // 既存のイベントリスナ除去のためクローン置換（安全・冪等）
      const cloned = undoBtn.cloneNode(true);
      undoBtn.replaceWith(cloned);
      cloned.addEventListener("click", onClickUndo); // ← onClickUndo 内で undoLastMove() を呼ぶ
    }

    // --- ほかのボタン（投了/リセット） ---
    setupResetButtonForState?.();
    document.getElementById("btn-resign-pvp")?.removeAttribute("disabled");

    // --- Undo の活性/非活性を最新化 ---
    updateUndoButtonAvailability?.();
  }

  // 利用可否は冪等でOK。必要な状態を参照して決める
  // 引数あり/なしどちらでもOK。d は /get_match_move の返答など。
  function updateUndoButtonAvailability(d) {
    const btn = document.getElementById("btn-undo");
    if (!btn) return;

    // 受け取れたらサーバ値、無ければローカルから安全に作る
    const kifuLen =
      (typeof d?.kifu_len === "number") ? d.kifu_len :
      (window.SHOGI?.state?.kifuLenClient ?? 0);

    const lastBy =
      (typeof d?.last_by === "string") ? d.last_by :
      (typeof window.lastSelfKifuLen === "number" &&
       (window.SHOGI?.state?.kifuLenClient === window.lastSelfKifuLen))
        ? String(role)         // 直前は自分が指した推定
        : null;

    const blocking = !!window.isResetting || !!window.gameOver || !!window.inPostGame || !!d?.finished;

    // ★新方針：直前の手を指したのが自分 かつ 対局継続中 かつ 着手がある
    const enable = !blocking && kifuLen > 0 && (String(lastBy).toLowerCase() === String(role).toLowerCase());

    btn.disabled = !enable;
    btn.title = enable ? "" : "直前の手を自分が指した直後のみ「一手戻る」が使えます";
  }

  function zeroLocalKifuState() {
    window.SHOGI ??= {}; (SHOGI.state ??= {}).kifuLenClient = 0;
    window.currentKifu ??= []; window.currentKifu.length = 0;
    window.lastSelfKifuLen = 0;
  }

  function drawInitialBoard() {
      fetch("/initial_board")  // ← 修正ポイント
        .then(res => res.json())
        .then(data => {
          drawBoardFromState2(data.board, data.captured);
        });
    }

  function checkForReset() {
    setInterval(() => {
      fetch("/get_sub_reload_url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: mainId, sub: subId })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          console.log("🔁 サブ側が再読み込みを開始します");
          window.location.href = data.url;
        }
      });
    }, 2000);  // 2秒ごとにチェック
  }

  function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
  }

  function unpromotePiece(piece) {
    // 成りを元に戻す（駒台用）
    if (piece.startsWith("+")) {
      return piece.substring(1);  // "+P" → "P"
    }
    return piece;
  }

  function resignGame2() {
    const msg = isMyTurn
      ? "あなたの番です。投了しますか？"
      : "相手の手番中です。投了すると対局は即終了します。よろしいですか？";
    if (!confirm(msg)) return;

    const btn = document.getElementById("btn-resign-pvp");
    btn?.setAttribute("disabled","disabled");

    fetch("/resign2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ main: mainId, sub: subId, resigner: role, id: playerId })
    })
    .then(r => r.json())
    .then(d => {
      if (!d.success) throw new Error(d.error || d.message || "投了失敗");
      //finalizeByResign({ winner: d.winner, resigner: d.resigner, reason: "resign" });
      finalizeByResign(d);

    })
    .catch(err => {
      alert("投了処理に失敗しました: " + err.message);
      btn?.removeAttribute("disabled");
    });
  }

  function flipIndex(index) {
    const row = Math.floor(index / 9);    // 0〜8
    const col = index % 9;                // 0〜8
    const flippedRow = 8 - row;
    const flippedCol = 8 - col;
    return flippedRow * 9 + flippedCol;   // 反転後のindex
  }
  
  function flipBoard(board) {
    return board.slice().reverse().map(row => row.slice().reverse());
  }

  function createPiece(code, isOpponent = false, forCaptured = false) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("piece-wrapper");

    const piece = document.createElement("div");
    piece.classList.add("piece");

    const pieceText = usiToKanji[code.toUpperCase()] || code;

    // 🔴 成駒なら赤くする
    const pieceElement = document.createElement("span");
    const plainChar = pieceText.replace("*", "").charAt(0);
    if ("と今杏全圭竜馬".includes(plainChar)) {
      pieceElement.classList.add("promoted");
    }
    pieceElement.innerText = pieceText;

    piece.appendChild(pieceElement);  // ✅ 文字は span 内に表示
    wrapper.appendChild(piece);       // ✅ .piece を wrapper に追加

    if (isOpponent) {
      wrapper.classList.add("opp-piece");
      piece.classList.add("opp-piece");
    }

    if (forCaptured) {
      wrapper.classList.add("captured-piece");
      piece.classList.add("captured-piece");

      // 駒台クリック処理
      wrapper.onclick = () => {
        selectedHandPiece = code;
        console.log("🟢 選択された駒:", selectedHandPiece);
        document.querySelectorAll(".captured-piece").forEach(p => p.classList.remove("selected"));
        wrapper.classList.add("selected");
      };
    }

    return wrapper;
  }

  function drawEmptyBoard2() {
    const boardElement = document.getElementById("board");
    boardElement.innerHTML = "";

    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.style.backgroundColor = "#fff";
        cell.dataset.row = row;
        cell.dataset.col = col;

        const index = row * 9 + col;
        const visibleIndex = isSubView ? (80 - index) : index;

        cell.dataset.index = index;

        // デバッグ用ラベル（必要であれば表示）
        const debugLabel = document.createElement("div");
        debugLabel.className = "cell-debug";
        debugLabel.textContent = `${visibleIndex}`;// メイン：0〜80 、サブ：８０〜０の連番になる
        cell.appendChild(debugLabel);

        boardElement.appendChild(cell);
      }
    }
    // 🧹 駒台も空にする
    document.getElementById("captured-pieces-self").innerHTML = "";
    document.getElementById("captured-pieces-opponent").innerHTML = "";

    updateTurnMessage("リセット中...");
  }

  function showMessage(text) {
    const area = document.getElementById("message-area");
    if (area) {
      area.innerHTML = text;
    }
  }

  function showMatchPanelAsMain(opponentId, firstPlayer) {
    const panel = document.getElementById("right-panel");

    panel.innerHTML = `
      <h3>対局中（あなたがメイン）</h3>
      <p>相手ID：<strong>${opponentId}</strong></p>
      <p>先手：<strong>${firstPlayer === "main" ? "あなた" : "相手"}</strong></p>
      <p id="turn-info">リセット中です</p>

      <button onclick="startGame2()">ゲーム開始</button>
      <button id="btn-reset" onclick="requestResetWithComment()">リセット要求</button>
      <button id="btn-save-kifu2" onclick="saveKifu2()">棋譜保存</button>
      <button id="btn-resign-pvp" onclick="resignGame2()">投了</button><br>
      <button id="btn-undo" type="button" disabled>一手戻る</button>
      <button onclick="returnToMainMenu2()">メインメニューに戻る</button><br>

      <h4>コメント欄</h4>
      <textarea id="main-comment-box" rows="3" style="width:100%"></textarea><br>
      <div id="comment-log" style="margin-top:10px;"></div>
    `;
  }

  function showMatchPanelAsSub(opponentId, firstPlayer) {
    const panel = document.getElementById("right-panel");

    panel.innerHTML = `
      <h3>対局中（あなたがサブ）</h3>
      <p>相手ID：<strong>${opponentId}</strong></p>
      <p>先手：<strong>${firstPlayer === "sub" ? "あなた" : "相手"}</strong></p>
      <p id="turn-info">リセット中です</p>

      <button onclick="resignGame2()">投了</button><br>
      <button id="btn-undo" type="button" disabled>一手戻る</button>
      <button onclick="returnToMainMenu2()">メインメニューに戻る</button><br>

      <button id="accept-reset-btn" style="display: none; background: red; color: white; animation: blink 1s infinite;">リセット承諾</button>

      <h4>コメント欄</h4>
      <textarea id="sub-comment-box" rows="3" style="width:100%"></textarea><br>
      <div id="comment-log" style="margin-top:10px;"></div>
    `;
  }

  function updateRightPanel(role, isMyTurn, isFirstPlayer) {
    const panel = document.getElementById("right-panel");

    const turnMessage = isMyTurn ? "あなたの手番です" : "相手の手番です";
    const firstMessage = isFirstPlayer ? "あなたは先手です" : "あなたは後手です";

    panel.innerHTML = `
      <h3>対人対局中（${role === "main" ? "メインID" : "サブID"}）</h3>
      <p><strong>${turnMessage}</strong></p>
      <p>${firstMessage}</p>

      <div id="message-area" style="border: 1px solid gray; padding: 5px; min-height: 40px;">
        <!-- 対局中のメッセージが表示されます -->
        </div>

        <button onclick="resignGame2()">投了</button>
        <button id="btn-undo" type="button" disabled>一手戻る</button>
        <button onclick="showInitialMenu()">メインメニューに戻る</button>
    `;
  }

  function returnToMainMenu2() {
    if (!confirm("メインメニューに戻りますか？（対局から離脱します）")) return;

    // ポーリングは全部止める
    //console.log("🔴returnToMainMenu-1:playerId =",playerId);  
    if (typeof stopPolling === "function") stopPolling();
    if (typeof stopPollUntilFirstMove === "function") stopPollUntilFirstMove();

    // 対局ペアの解消（メインの仕事）
    if ( role === "main") {
      fetch("/leave_match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: mainId, sub: subId, role })
      }).catch(() => {});
    }

    window.location.href = "/";
  }

  function stopPollUntilFirstMove() {
    firstMoveMode = false;
    if (pollFirstMoveTimer) {
      clearInterval(pollFirstMoveTimer);
      pollFirstMoveTimer = null;
    }
  }

  async function startGame2() {
    console.log("😂window.isResetting at startGame-1=", window.isResetting);

    const btn =
      document.querySelector("button[onclick='startGame2()']") ||
      document.getElementById("start-game-btn");

    // グローバル変数初期化
    initGlobal();

    // 二重押し防止＆見た目
    if (btn) {
      btn.disabled = true;
      btn.style.backgroundColor = "red";
    }

    // 既存ポーリングが残っていたら止めてクリーンスタート
    if (typeof stopPolling === "function") stopPolling();

    const log = document.getElementById("comment-log");

    // ---- 追加：中断スナップショットからの再開チャンスを先に確認 ----
    try {
      const resList = await fetch("/snapshot/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: mainId, sub: subId })
      });
      const dList = await resList.json();

      console.log("🟢 dList.status",dList.status);
      console.log("🟢 Array.isArray(dList.items",Array.isArray(dList.items));
      console.log("🟢 dList.items.length",dList.items.length);

      // 中断候補があれば確認ダイアログ
      if (dList.status === "ok" && Array.isArray(dList.items) && dList.items.length > 0) {
        const wantResume = confirm("中断局面から再開しますか？（OK=再開 / キャンセル=新規）");
        if (wantResume) {
          const target = dList.items[0]; // まずは最新1件を採用（あとでUIに拡張可）
          const resResume = await fetch("/snapshot/resume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ main: mainId, sub: subId, file: target.file })
          });
          const dResume = await resResume.json();
          console.log("🟢 dResume.status =",dResume.status);
          if (dResume.status === "ok") {
            if (log) log.innerHTML += `<div>🟢 中断局面から再開しました</div>`;

            // 盤面取得→描画→手番メッセージ→必要ならポーリング開始
            await fetchAndDrawMatchBoard();
            console.log("🟢 isMyTurn = ", isMyTurn);
            if (isMyTurn) {
              updateTurnMessage("あなたの番です");
              stopPolling();
            } else {
              updateTurnMessage("相手が考え中です");
              console.log("😂window.isResetting at startGame-4=", window.isResetting);
              if (!pollingActive) startPolling(0); else queueNextPoll(0);
            }
            return; // ← 再開できたのでここで終了（新規開始には行かない）
          } else {
            if (log) log.innerHTML += `<div style="color:orange">⚠ 再開に失敗したため新規開始に切り替えます</div>`;
          }
        }
      }
    } catch (e) {
      // スナップショット探索に失敗しても新規開始にフォールバック
      console.warn("snapshot/list failed, fallback to new game:", e);
    }
    // ---- 追加ここまで ----------------------------------------------------

    // ここからは「従来の新規開始フロー」をそのまま踏襲
    fetch("/start_match_game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ main: mainId, sub: subId, first: first })
    })
      .then((res) => res.json())
      .then((data) => {
        const log = document.getElementById("comment-log");

        if (data.status === "ok") {
          if (log) log.innerHTML += `<div>🟢 対局を開始しました</div>`;

          // 盤面取得→描画→手番メッセージ→必要ならポーリング開始
          return fetchAndDrawMatchBoard().then(() => {
            console.log("🟢 isMyTurn = ", isMyTurn);
            if (isMyTurn) {
              updateTurnMessage("あなたの番です");
              stopPolling();
            } else {
              updateTurnMessage("相手が考え中です");
              console.log("😂window.isResetting at startGame-4=", window.isResetting);
              if (!pollingActive) startPolling(0); else queueNextPoll(0);
            }
          });
        } else {
          const msg = `対局開始に失敗しました: ${data.message || "unknown error"}`;
          console.error(msg);
          if (log) log.innerHTML += `<div style="color:red">⚠ ${msg}</div>`;
          if (btn) {
            btn.disabled = false;
            btn.style.backgroundColor = ""; // 元に戻す
          }
        }
      })
      .catch((err) => {
        console.error("start_match_game error:", err);
        const log = document.getElementById("comment-log");
        if (log) log.innerHTML += `<div style="color:red">⚠ 通信エラー: ${String(err)}</div>`;
        if (btn) {
          btn.disabled = false;
          btn.style.backgroundColor = ""; // 元に戻す
        }
      });
  }

  async function resetGame2() {
    console.log("♻️ resetGame2: サーバ初期化 → 空盤描画 → 右パネル再生成");

    // 1) 安全のため停止
    stopPolling?.();
    stopPostGameHeartbeat?.();

    // 2) サーバへリセット実行（あなたの設計ならここで初期化が走る）
    const res = await fetch("/reset_match_game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ main: mainId, sub: subId, first }) // ←必要なペイロード
    });
    const data = await res.json();
    if (data.status !== "ok" && data.ok !== true) {
      throw new Error(data.message || "reset_match_game failed");
    }

    // 3) 表示の初期化（あなたの仕様は「空の盤」を表示）
    drawEmptyBoard2(); // ← 既存の空盤描画ヘルパ

    // 4) 右パネル再描画（DOM を再構築）
    if (role === "main") {
      showMatchPanelAsMain(subId ?? sub, data.first ?? first);
    } else {
      showMatchPanelAsSub(mainId ?? main, data.first ?? first);
    }

    // 5) ローカル状態は呼び出し元でゼロ化済み
    //    ここでは何もしない（afterUiRedrawHooksでバインドする）
  }

  function amSente(){ return role === firstPlayer; }            // 自分が先手？
  function toVisualBoard(absBoard){ return amSente() ? absBoard : flipBoard(absBoard); }
  function fromAbsIndex(i){ return amSente() ? i : flipIndex(i); }
  function toAbsIndex(i){ return amSente() ? i : flipIndex(i); }

  // 盤・持ち駒・手番の同期と描画をまとめて行う
  // 例：安全な fetchAndDrawMatchBoard（差し替え）
  async function fetchAndDrawMatchBoard(opts = {}) {
    const { allowKifuSync = false } = opts; // ← デフォルトは同期しない

    // 安全な初期化
    window.SHOGI ??= {};
    SHOGI.state ??= {};

    const res = await fetch("/get_match_board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ main: mainId, sub: subId, player: role }) // サーバ互換：player/roleどちらでもOK実装に合わせる
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("get_match_board failed:", res.status, res.statusText, "\n", text);
      return; // ここは呼び出し側で再試行スケジュール済みの前提
    }

    const d = await res.json();
    if (d.status !== "ok") throw new Error(d.message || "get_match_board NG");

    // --- 先後（first）反映 ---
    if (d.first) firstPlayer = d.first; // "main" | "sub"

    // --- 盤面9x9を堅牢に整形 ---
    const boardArr = Array.isArray(d.board)
      ? d.board
      : Array.from({ length: 9 }, () => Array(9).fill(""));
    const visBoard = (role === firstPlayer) ? boardArr : flipBoard(boardArr);

    // --- 描画 ---
    drawBoardFromState2(visBoard, d.captured ?? { main: [], sub: [] });
    afterUiRedrawHooks(); // ←ココを必ず

    // --- 手番判定（サーバ優先 / 無ければ偶奇で補完） ---
    // 自分が "main" か "sub" かをまず決める（画面反転と無関係）
    const mySide = (role === firstPlayer) ? "main" : "sub";

    // 1) サーバが turn を "main"/"sub" で返してきたらそれを信頼
    let turnSide = null;
    if (typeof d.turn === "string" && (d.turn === "main" || d.turn === "sub")) {
      turnSide = d.turn;
    } else {
      // 2) ブール互換フィールドがあれば一応拾う（互換維持）
      if (typeof d.isMyTurn === "boolean") {
        isMyTurn = d.isMyTurn;
      } else if (typeof d.is_my_turn === "boolean") {
        isMyTurn = d.is_my_turn;
      } else {
        // 3) 最後の砦：偶奇計算で補完
        const ply = (typeof d.kifu_len === "number" && d.kifu_len >= 0) ? d.kifu_len : 0;
        const firstSide = d.first || firstPlayer || "main"; // 念のため既定値
        const opp = (s) => (s === "main" ? "sub" : "main");
        // 偶数手後は先手(first)の手番、奇数手後は相手
        turnSide = (ply % 2 === 0) ? firstSide : opp(firstSide);
      }
    }

    // turnSide が決まっていればそれで isMyTurn を上書き
    if (turnSide) {
      isMyTurn = (turnSide === mySide);
    }

    updateTurnMessage(isMyTurn ? "あなたの番です" : "相手が考え中です");

    // --- リセット検知：phase/init or reset_epoch 変化 ---
    const resetDetected =
      d.phase === "init" ||
      (typeof d.reset_epoch === "number" && d.reset_epoch !== (window._lastResetEpoch ?? -1));

    console.log("❌ [fADMB] allowKifuSync =", allowKifuSync, " resetDetected =", resetDetected);

    // --- ★ 同期は“リセット検知 or 明示許可”のときだけ ---
    if (resetDetected || allowKifuSync) {
      // 前対局の値を確実に落とす
      window.currentKifu ??= [];
      window.currentKifu.length = 0;

      // サーバの棋譜長に合わせる（初期局面なら通常 0）
      const serverLen = (typeof d.kifu_len === "number" && d.kifu_len >= 0) ? d.kifu_len : 0;
      window.__kifuSetReason = resetDetected ? "reset/init" : "allowSync";
      SHOGI.state.kifuLenClient = serverLen;

      // “自分手エコー回避”の基準も同じ値に（= 多くは 0）
      window.lastSelfKifuLen = serverLen;

      // reset_epoch を記録
      window._lastResetEpoch = d.reset_epoch ?? window._lastResetEpoch;

      console.log(
        "❌ [fADMB] synced: kifuLenClient =",
        SHOGI.state.kifuLenClient,
        " lastSelfKifuLen =",
        window.lastSelfKifuLen
      );
    }

    console.log("❌ [fADMB] final kifuLenClient =", SHOGI.state.kifuLenClient);

    // 必要なら結果を返す（呼び出し側で使う用）
    return d;
  }

  function updateTurnMessage(message) {
    const info = document.getElementById("turn-info");
    if (info) {
      info.textContent = message;
    }
  }

  function drawBoardFromState2(board, captured) {
    boardElement.innerHTML = "";

    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        const index = row * 9 + col;
        cell.dataset.index = index;
        cell.dataset.row = row;
        cell.dataset.col = col;
        cell.id = `${row}${col}`;

        const pieceSymbol = board[row][col];
        if (pieceSymbol) {
          // 表示文字を取得（＊は除去）
          const pieceCode = pieceSymbol.replace("*", "");
          const pieceText = usiToKanji[pieceCode] || pieceCode;

          // 所属の判定（＊がある＝後手）
          const isWhitePiece = pieceSymbol.startsWith("*");
          const isPlayerWhite = (first !== role);  // 自分が後手か
          const isOpponent = isWhitePiece !== isPlayerWhite;

          const piece = createPiece(pieceText, isOpponent);
          cell.appendChild(piece);
        }

        cell.onclick = () => handleCellClick2(cell);
        boardElement.appendChild(cell);
        drawCellNumber();
      }
    }

    updateCapturedPieces2(captured);
  }

  function drawCellNumber() {
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const cell = document.getElementById(`${row}${col}`);
        if (!cell) continue;

        const coord = document.createElement("div");
        coord.className = "cell-debug";

        let index;
        if (first === role) {
          index = row * 9 + col;
        } else {
          const flippedRow = 8 - row;
          const flippedCol = 8 - col;
          index = flippedRow * 9 + flippedCol;
        }
        //console.log("index at drawCellNumber=",index);
        coord.innerText = index;
        cell.appendChild(coord);
      }
    }
  }
  
  function updateCapturedPieces2(capturedParam) {
    console.log("🔷captured at top =",capturedParam);
    const playerCapturedDiv = document.getElementById("captured-pieces-self");
    const oppCapturedDiv = document.getElementById("captured-pieces-opponent");

    playerCapturedDiv.innerHTML = "";
    oppCapturedDiv.innerHTML = "";

    const myCaptured = (role === "main") ? capturedParam.main : capturedParam.sub;
    const oppCaptured = (role === "main") ? capturedParam.sub : capturedParam.main;

    console.log("🔷captured =",capturedParam);
    console.log("🟢myCaptured =", myCaptured);
    console.log("🟢oppCaptured =", oppCaptured);

    if (Array.isArray(myCaptured)) {
      myCaptured.forEach(piece => {
        const el = createPiece(unpromotePiece(piece), false, true);
        console.log("🟡描画：自分", el);
        playerCapturedDiv.appendChild(el);
      });
    }

    if (Array.isArray(oppCaptured)) {
      oppCaptured.forEach(piece => {
        const el = createPiece(unpromotePiece(piece), true, true);
        console.log("🟡描画：相手", el);
        oppCapturedDiv.appendChild(el);
      });
    }
    // 🔽 この行を最後に追加
    setupCapturedPieceClicks();
  }

  function setupCapturedPieceClicks() {
    const allCapturedPieces = document.querySelectorAll(".captured-piece");

    allCapturedPieces.forEach(piece => {
      piece.onclick = () => {
        // 駒の種類を取得
        const pieceText = piece.innerText;
        const usiCode = Object.keys(usiToKanji).find(key => usiToKanji[key] === pieceText);

        if (!usiCode) {
          console.warn("🟡クリックされた駒に対応するUSIコードが見つかりません:", pieceText);
          return;
        }

        selectedHandPiece = usiCode;
        console.log("🔵駒台から選択された駒:", selectedHandPiece);

        // 全駒の選択状態をリセットし、この駒だけに枠線をつけるなど（任意）
        allCapturedPieces.forEach(p => p.classList.remove("selected"));
        piece.classList.add("selected");
      };
    });
  }


  function waitForGameStart() {
    const intervalId = setInterval(() => {
      fetch("/check_match_start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ main: mainId, sub: subId })
      })
      .then(res => res.json())
      .then(data => {
        if (data.started) {
          clearInterval(intervalId);

          const isFirstPlayer = (role === data.first);  // ← 先手判定

          // 🔷 初期盤面描画
          fetchAndDrawMatchBoard().then(myTurn => {
            stopPolling(); // ← 一時的に走っていたstartPollingを止める（あれば）

            const log = document.getElementById("comment-log");
            if (log) log.innerHTML += `<div>🟢 対局を開始しました</div>`;

            if (isFirstPlayer) {
              // ✅ 自分が先手 → 自分のターン
              updateTurnMessage("あなたの番です");
            } else {
              // ✅ 自分が後手 → 相手の初手を待つ
              startPolling();        // 一時的な盤面表示（強制更新）
              //pollUntilFirstMove();  // 相手の初手を検知したら止めて切り替え
            }
          });
        }
      });
    }, 2000);
  }

  function waitForResetAndStartPolling() {
    const intervalId = setInterval(() => {
      fetch("/get_match_board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: mainId, sub: subId, player: playerId })
      })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok" && data.board) {
          console.log("🔁 サブ側：盤面初期化を検知、ポーリング開始");

          drawBoardFromState2(data.board, data.captured);

          clearInterval(intervalId);  // ✅ 多重実行を防ぐ
          startPolling();  // ✅ 盤面更新ポーリング開始
        } else {
          console.log("⏳ サブ側：まだ盤面が準備できていません");
        }
      })
      .catch(err => {
        console.error("❌ サブ側：盤面の取得に失敗", err);
      });
    }, 2000);
  }

  function dbg(tag) {
    console.log(`DBG ${tag} :: PA=${pollingActive} isMyTurn=${isMyTurn} window.isResetting=${window.isResetting} role=${role}`);
  }

  function queueNextPoll(ms) {
    dbg("queueNextPoll begin");
    console.log("queueNextPoll", ms, "PA(before)=", pollingActive);
    clearTimeout(pollTimer);
    if (!pollingActive) return;                 // ここで落ちないよう、直前にfalseにしない
    pollTimer = setTimeout(() => {
      console.log("⏰ fire pollForOpponentMove");
      pollForOpponentMove();
    }, ms);
  }

  function startPolling(delay = 0) {
    dbg("startPolling begin");
    console.log("startPolling() called, PA(before)=", pollingActive);
    if (pollingActive) return queueNextPoll(delay);
    pollingActive = true;                       // 先に true にする
    console.log("startPolling() -> PA=true");
    queueNextPoll(delay);
  }

  function stopPolling() {
    dbg("stopPolling begin");
    console.log("stopPolling() called, PA(before)=", pollingActive);
    pollingActive = false;
    clearTimeout(pollTimer);
    pollTimer = null;
    console.log("stopPolling() -> PA=false");
  }
  
  async function pollUntilFirstMove() {
    console.log("🔄 pollUntilFirstMove: 開始");
    fromWhere = "at pollUntilFirstMove-1";
    console.log("firstMoveMode=",firstMoveMode);
    if (!firstMoveMode) return; // ← これが無いと止まらない

    if (pollFirstMoveTimer) {
      clearInterval(pollFirstMoveTimer);
    }

    fromWhere = "at pollUntilFirstMOve-2:before try";
    pollFirstMoveTimer = setInterval(async () => {
      try {
        console.log("🔁 pollUntilFirstMove: 相手の初手確認中...");

        const res = await fetch("/get_match_move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            main: mainId,
            sub: subId,
            role: role,
            kifu_len: currentKifu.length
          })
        });

        const data = await res.json();
        console.log("🔺 data.status =", data.status);

        if (data.status === "move") {
          console.log("🟢 pollUntilFirstMove: 相手の初手を検知");

          clearInterval(pollFirstMoveTimer);
          pollFirstMoveTimer = null;
          stopPollUntilFirstMove();
          //stopPolling(); // 念のため

          await drawInitialBoard();

          let visualFrom = data.from;
          let visualTo = data.to;
          let flippedBoard = data.board;

          if (role !== first) {
            if (visualFrom !== null) visualFrom = flipIndex(visualFrom);
            visualTo = flipIndex(visualTo);
            flippedBoard = flipBoard(data.board);
          }

          if (role !== first) {
            console.log("⭕️ pollUntilFirstMove: animate 相手の初手");
            await animateMove2(
              visualFrom,
              visualTo,
              flippedBoard,
              data.captured,
              data.winner,
              data.promote || false
            );

            currentKifu.push({
              from: data.from,
              to: data.to,
              promote: data.promote,
              by: role === "main" ? "sub" : "main"
            });

            updateTurnMessage("あなたの番です");
            isMyTurn = true;
          } else {
            drawBoardFromState2(flippedBoard, data.captured);
            updateTurnMessage("相手が考え中です");
            isMyTurn = false;
          }

          // コメント表示（任意）
          if (data.comment) {
            const commentLog = document.getElementById("comment-log");
            if (commentLog) {
              commentLog.innerHTML += `
                <div><strong>🔳 相手のコメント:</strong> ${data.comment}</div>
              `;
            }
          }

          drawCellNumber();

          // ✅ 後手側（role !== first）だけ通常のポーリングを開始
          if (role !== first) {
            console.log("🔄 pollUntilFirstMove → pollForOpponentMove 切り替え");
            fromWhere = "at pollUntilFirstMOve-2:before startPolling";
            startPolling();
          }
        }

      } catch (err) {
        console.error("🔥 pollUntilFirstMove fetch error:", err);
      }
    }, 2000);
  }

  async function handleCellClick2(cell) {
    console.log("❌isResetRequesting = ",isResetRequesting,"isMyTurn = ",isMyTurn);
    if (isResetRequesting) return;

    if (!isMyTurn) return;

    const index = parseInt(cell.dataset.index);
    const pieceElement = cell.querySelector(".piece");

    // 🔹 dropPiece は選択中の駒台の駒
    const dropPiece = selectedHandPiece ? selectedHandPiece : null;

    // --- 打ち込み処理 ---
    if (selectedHandPiece !== null) {
      const visualFrom = null;
      const visualTo = index;
      const sendTo = role !== first ? flipIndex(index) : index;
      console.log("📤 dropPiece =", dropPiece);
      await submitMove(null, sendTo, dropPiece, false, visualFrom, visualTo);
      selectedHandPiece = null;
      drawCellNumber();
      return;
    }

    // --- 通常の指し手処理 ---
    if (!selectedCell2) {
      if (pieceElement && isOwnPiece(pieceElement)) {
        selectedCell2 = cell;
        cell.classList.add("selected");
      }
      return;
    }

    if (cell === selectedCell2) {
      selectedCell2.classList.remove("selected");
      selectedCell2 = null;
      await sleep(500);
      return;
    }

    // 既存:
    const fromIndex = parseInt(selectedCell2.dataset.index);
    const toIndex   = index;

    // 盤の向きを実局面に合わせる（あなたの既存ロジックに合わせて）
    const meIsFirst = (role === first);
    const sendFrom  = meIsFirst ? fromIndex : flipIndex(fromIndex);
    const sendTo    = meIsFirst ? toIndex   : flipIndex(toIndex);
    const rFrom     = Math.floor(sendFrom / 9);
    const rTo       = Math.floor(sendTo   / 9);

    console.log("🔺meIsFirst=",meIsFirst);
    console.log("🔻sendFrom=",sendFrom,"🔻sendTo=",sendTo);

    const movingPieceName = selectedCell2.querySelector(".piece")?.innerText || "";
    const promotable = new Set(["歩","香","桂","銀","飛","角"]);

    let isPromotion = false;
    if (promotable.has(movingPieceName)) {
      // 先手なら敵陣は 0,1,2 段、後手なら 6,7,8 段
      const enemyZone    = meIsFirst ? [0,1,2] : [6,7,8];
      const enemyLast    = meIsFirst ? 0 : 8;
      const enemyLastTwo = meIsFirst ? new Set([0,1]) : new Set([7,8]);

      // 成れる条件：from または to が敵陣
      const canPromote = enemyZone.includes(rFrom) || enemyZone.includes(rTo);

      // 成らねばならない条件
      const mustPromote =
        ((movingPieceName === "歩" || movingPieceName === "香") && rTo === enemyLast) ||
        (movingPieceName === "桂" && enemyLastTwo.has(rTo));

      if (canPromote) {
        isPromotion = mustPromote ? true : confirm("成りますか？");
      }
    }

    // 以降は既存どおり、サーバに送る promote フラグへ反映
    const promote = isPromotion;

    const visualFrom = fromIndex;
    const visualTo = toIndex;

    await submitMove(sendFrom, sendTo, null, isPromotion, visualFrom, visualTo);

    selectedCell2.classList.remove("selected");
    selectedCell2 = null;
  }

  async function submitMove(sendFrom, sendTo, dropPiece, promote, visualFrom, visualTo) {
    const submitBtn = document.getElementById("submit-move-btn");
    if (submitBtn) submitBtn.disabled = true;

    // コメント取得
    const box = (role === "main")
      ? document.getElementById("main-comment-box")
      : document.getElementById("sub-comment-box");
    const comment = box ? (box.value || "") : "";

    const payload = {
      main: mainId,
      sub:  subId,
      role,
      from: sendFrom,                 // サーバ座標
      to:   sendTo,                   // サーバ座標
      drop: dropPiece ?? null,
      promote: !!promote,
      comment
    };

    try {
      const res  = await fetch("/submit_match_move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      //const data = await res.json();

      // ★ JSONの前に必ずテキストを取る
      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        console.error("submit_match_move HTTP", res.status, res.statusText);
        console.error("---- server body ----\n" + raw);
        throw new Error(`Server returned ${res.status} (not JSON)`);
      }

      if (data.status !== "move") {
        throw new Error(data.message || "submit_move failed");
      }

      // --- 表示用盤面（先後反転） ---
      let boardForView = data.board;
      let vFrom = visualFrom;
      let vTo   = visualTo;
      if (first !== role) {
        boardForView = flipBoard(boardForView);
        // vFrom/vTo は呼び出し側で反転済み想定。未反転ならここで flipIndex する
      }

      // 自分の手をアニメ適用（成功返ってからでOK）
      console.time("animateMove2");
      await animateMove2(vFrom, vTo, boardForView, data.captured, data.winner, !!data.promote);
      console.timeEnd("animateMove2");

      // 互換：ローカル棋譜（サーバ座標で持つ）
      window.currentKifu ??= [];
      window.currentKifu.push({
        from: sendFrom,
        to:   sendTo,
        drop: dropPiece ?? null,
        promote: !!promote,
        by: role
      });

      drawCellNumber?.();

      // ★ “詰み”はここで即終局（相手待ちにしない）
      if (data.finished && data.reason === "checkmate") {
        finalizeByCheckmate?.(data);   // 共通の終局処理（投了と同じ流れ）
        return;                        // ポーリング再開しない（finalize内で終局心拍へ）
      }

      // 通常：相手待ちへ
      isMyTurn = false;
      updateTurnMessage?.("相手が考え中です");

      // 既知の棋譜長をサーバ値に同期（無ければ+1）
      window.SHOGI ??= {}; (SHOGI.state ??= {});
      if (typeof data.kifu_len === "number") {
        window.__kifuSetReason = "selfMove(server)";
        SHOGI.state.kifuLenClient = data.kifu_len;
      } else {
        window.__kifuSetReason = "selfMove(+1)";
        SHOGI.state.kifuLenClient = (SHOGI.state.kifuLenClient ?? 0) + 1;
      }
      // “直前に自分が進めた長さ”を記録 → 自己エコー弾きに使用
      window.lastSelfKifuLen = SHOGI.state.kifuLenClient;

      // コメント欄クリア（任意）
      if (box) box.value = "";

      // ポーリング再開（多重防止）
      if (!pollingActive) startPolling(0); else queueNextPoll(0);

    } catch (err) {
      console.error("❌ submitMove error:", err);
      alert("❌ エラー: " + String(err));
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function animateMove2(from, to, board, captured, winner = null, fromElement = null) {
  
    const fromRow = from !== null ? Math.floor(from / 9) : null;
    const fromCol = from !== null ? from % 9 : null;
    const toRow = Math.floor(to / 9);
    const toCol = to % 9;

    let highlightCells = [];

    // 取得ヘルパ（null なら null を返す）
    //const getCellEl = (idx) => document.querySelector(`[data-idx="${idx}"]`);

    console.log("🟠animateMove2");
    console.log("🟠from=",from,"🟠to=",to,"🟠board=",board);

    if (from !== null) {

      // ⭐ ハイライトを取得
      const highlightCells = highlightMove2B(from, to, board);

      await sleep(500);

      // 1. captured_by_◯◯ に保存している値を fallback として使う
      console.log("🔶 captured before updateCapturedPieces =",captured);
      
      drawBoardFromState2(board, captured);

      // ⭐ 再度ハイライト（新たに追加）
      const reHighlightedCells = highlightMove2B(from, to, board);

      await sleep(500);

      // ⭐ 再ハイライトしたセルを消去
      reHighlightedCells.forEach(cell => {
        cell.classList.remove("highlight-from", "highlight-to", "highlight-middle");
      });
    }

    // --- 打ち込み（駒台から） ---
    else {
      let toCell = document.querySelector(`.cell[data-row='${toRow}'][data-col='${toCol}']`);
      if (toCell) toCell.classList.add("highlight-drop");

      await sleep(1000);

      // 1. captured_by_◯◯ に保存している値を fallback として使う
      console.log("🔶 captured before updateCapturedPieces =",captured);

      // 3. 盤面を描画（capturedを渡すのは任意）
      drawBoardFromState2(board, captured);

      toCell = document.querySelector(`.cell[data-row='${toRow}'][data-col='${toCol}']`);
      if (toCell) toCell.classList.add("highlight-drop");

      await sleep(1000)

      if (toCell) toCell.classList.remove("highlight-drop");
    }
  }

  function highlightMove2B(from, to, board) {
    const highlightCells = [];

    const fromRow = from !== null ? Math.floor(from / 9) : null;
    const fromCol = from !== null ? from % 9 : null;
    const toRow = Math.floor(to / 9);
    const toCol = to % 9;

    if (from !== null) {
      const fromCell = document.querySelector(`.cell[data-row='${fromRow}'][data-col='${fromCol}']`);
      if (fromCell) {
        fromCell.classList.add("highlight-from");
        highlightCells.push(fromCell);
      }
    }

    const toCell = document.querySelector(`.cell[data-row='${toRow}'][data-col='${toCol}']`);
    if (toCell) {
      toCell.classList.add("highlight-to");
      highlightCells.push(toCell);
    }

    // --- from → to の間のセルもハイライト ---
    console.log("to at highlightMobe2B=",to);
    let piece = board[Math.floor(to / 9)][to % 9];  // 例: "*今" または "桂" など

    // 先頭の *（相手駒）を取り除く
    const plainPiece = piece.startsWith("*") ? piece.slice(1) : piece;

    // 桂または成桂（"圭"）かどうかを判定
    const isKnight = plainPiece === "桂" || plainPiece === "圭";

    if (!isKnight) {
      const dRow = Math.sign(toRow - fromRow);
      const dCol = Math.sign(toCol - fromCol);
      let r = fromRow + dRow;
      let c = fromCol + dCol;
      let steps = 0;

      while ((r !== toRow || c !== toCol) && steps++ < 20) {
        const midCell = document.querySelector(`.cell[data-row='${r}'][data-col='${c}']`);
        if (midCell) {
          midCell.classList.add("highlight-middle");
          highlightCells.push(midCell);
        }
        r += dRow;
        c += dCol;
      }
    }

    return highlightCells;
  }

  function isOwnPiece(pieceElement) {
    if (!pieceElement) return false;
    const wrapper = pieceElement.closest(".piece-wrapper");
    if (!wrapper || !wrapper.classList) return false;
    return !wrapper.classList.contains("opp-piece");
  }

  function shouldAskPromotion(piece, fromRow, toRow, role) {
    const promotable = ["歩", "香", "桂", "銀", "角", "飛"];
    const isInZone = role === "main" ? (fromRow <= 2 || toRow <= 2) : (fromRow >= 6 || toRow >= 6);
    return promotable.includes(piece) && isInZone;
  }

  async function pollForOpponentMove() {
    if (!pollingActive) return;

    const isResettingNow = !!window.isResetting;
    const myTurnNow = !!isMyTurn && !window.isResettingNow;
    const delayMy  = 1500;
    const delayOpp = 800;

    console.log("go poll:", {
      pollingActive,
      isMyTurn,
      isResetting: isResettingNow,
      role,
      client_kifu_len: (SHOGI.state?.kifuLenClient ?? 0),
    });

    dbg?.("pollForOpponentMove begin");

    try {
      const res = await fetch("/get_match_move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          main: mainId,
          sub: subId,
          role,
          client_kifu_len: (SHOGI.state?.kifuLenClient ?? 0),
        }),
      });
      
      // ★ まずHTTPステータスを確認
      if (!res.ok) {
        const text = await res.text();  // HTMLのエラーページをそのままログ
        console.error("get_match_move failed:", res.status, res.statusText, "\n", text);
        // 少し待って再試行（サーバがリセット中の一時的な500にも有効）
        if (!pollingActive) startPolling(2000); else queueNextPoll(2000);
        return;
      }
      
      const data = await res.json();

      console.log("🟣 status:", data.status,
                  " reset_requested:", data.reset_requested,
                  " reset_accepted:", data.reset_accepted,
                  " kifu_len:", data.kifu_len,
                  " finished:", data.finished);

      // ===== 0) 相手コメント（冪等） =====
      (function updateOpponentComment(){
        const commentLog = document.getElementById("comment-log");
        if (!commentLog || !("comment" in data)) return;
        const comment = data.comment ?? "";
        let area = document.getElementById("opponent-comment-line");
        if (!area) {
          area = document.createElement("div");
          area.id = "opponent-comment-line";
          commentLog.appendChild(area);
        }
        if (lastOpponentComment !== comment) {
          area.innerHTML = comment
            ? `💬 <span style="font-weight:bold;color:red;">相手のコメント: ${comment}</span>`
            : "💬 相手のコメント: （コメントなし）";
          lastOpponentComment = comment;
        }
      })();

      // ===== 1) リセット承諾（最優先） =====
      if (data.reset_accepted) {
        console.log("🟢 reset_accepted → resetGame2() 開始");

        try {
          window.isResetting = true;

          // 幽霊タイマー停止（通常ポーリング／終局心拍）
          stopPolling?.();
          stopPostGameHeartbeat?.();

          zeroLocalKifuState(); 

          // ローカル状態を先にゼロ化（前対局の長さや自己エコー判定を消す）
          window.SHOGI ??= {}; (SHOGI.state ??= {});
          SHOGI.state.kifuLenClient = 0;
          window.currentKifu ??= []; window.currentKifu.length = 0;
          window.lastSelfKifuLen = 0;

          // ★ サーバ実初期化 + UI再構築（空盤を描くあなたの仕様）
          await resetGame2();                  // ← ここは await 必須

          // ★ UI/DOM の再バインドを確実に
          afterUiRedrawHooks();

          inPostGame = false;
          gameOver   = false;

          setupResetButtonForState?.();
          //enableBoardUI?.();

          // ポーリング再開（自分番はやや緩め）
          if (!pollingActive) startPolling(isMyTurn ? 900 : 600);
          else queueNextPoll?.(0);

        } catch (e) {
          console.error("reset_accepted branch error:", e);
        } finally {
          window.isResetting = false; // ← 必ず下げる
        }

        return;
      }
   
      // ===== 2) サーバ不整合 → resync =====
      if (data.status === "resync") {
        // ① ローカル状態を完全クリア（共通ヘルパで一発）
        zeroLocalKifuState();  // ← SHOGI.state.kifuLenClient=0, currentKifu=[], lastSelfKifuLen=0

        // ② フル同期（サーバ真実を描画）
        await fetchAndDrawMatchBoard({ allowKifuSync: true });

        // ③ サーバが長さを返すなら合わせる（通常は0）
        if (typeof data.kifu_len === "number" && data.kifu_len >= 0) {
          window.__kifuSetReason = "resync";
          SHOGI.state.kifuLenClient = data.kifu_len;
        }
        window.lastSelfKifuLen = SHOGI.state.kifuLenClient ?? 0;

        // ④ UIの再バインド＆Undo活性/非活性の最新化
        afterUiRedrawHooks?.();
        updateUndoButtonAvailability?.(
          pickUndoFields({ kifu_len: SHOGI.state.kifuLenClient, finished: false })
        );

        // ⑤ ポーリング再開
        if (!pollingActive) startPolling(600); else queueNextPoll?.(0);
        return;
      }

      // ===== 2.5) kifu_len 同期は “move / resync / end” だけ =====
      console.log("🔴 data.kifu_len = ",data.kifu_len);
      console.log("🔴 data.status = ",data.status);
      console.log("❌ kifuLenClient before = ",SHOGI.state.kifuLenClient);
      if (typeof data.kifu_len === "number" &&
          (data.status === "resync" || data.status === "end") && data.kifu_len >= 0) {
        window.__kifuSetReason = data.status;
        SHOGI.state.kifuLenClient = data.kifu_len;
      }
      console.log("❌ kifuLenClient after = ",SHOGI.state.kifuLenClient);
      // ※ wait 応答では絶対に触らない

      // ===== 3) リセット要求（承諾待ち） =====
      if (data.reset_requested) {
        dbg?.("pollForOpponentMove reset_requested");
        window.isResetting = true; // UI操作をブロック

        const comment = data.comment || "（コメントなし）";
        const isFromMe = (data.from === role);

        let area = document.getElementById("reset-request-area");
        if (!area) {
          area = document.createElement("div");
          area.id = "reset-request-area";
          area.style.marginTop = "8px";
          document.getElementById("comment-log")?.appendChild(area);
        }
        if (!hasShownResetRequest) {
          hasShownResetRequest = true;
          area.innerHTML = isFromMe
            ? `<div><strong>🔁 リセット要求:</strong> ${comment}（←あなた）</div>`
            : `<div><strong>🔁 リセット要求:</strong> ${comment}</div>
               <button id="accept-reset-btn" style="animation: blink-text 1s infinite;">
                 リセットを承諾する
               </button>`;
          if (!isFromMe) {
            area.querySelector("#accept-reset-btn")
                ?.addEventListener("click", acceptReset, { once: true });
          }
        }
        if (isFromMe) { if (!pollingActive) startPolling(1000); else queueNextPoll(1000); }
        else { stopPolling?.(); }
        return;
      }

      // ===== 4) リセット中は通常手を処理しない =====
      console.log("🟢 window.isResetting before finished = ",window.isResetting);
      if (window.isResetting) {
        if (!pollingActive) startPolling(1200); else queueNextPoll(1200);
        dbg?.("pollForOpponentMove (window.isResetting)");
        return;
      }

      // ===== 5) 終局 =====
      if (data.finished) {
        if (data.reason === "resign") {
          finalizeByResign?.(data);
        } else if (data.reason === "checkmate") {
          finalizeByCheckmate?.(data);
        }
        updateUndoButtonAvailability({ last_by: null, kifu_len: SHOGI.state?.kifuLenClient ?? 0, finished: true });
        stopPolling?.();
        return;
      }

      // ===== 6) 通常の手 =====
      if (data.status === "move") {
        const clientLen = (SHOGI.state?.kifuLenClient ?? 0);
        console.log("🟢 move分岐(0)");

        // ★ (A) 自分が送った手のエコーなら即スキップ
        if (typeof data.by === "string" && data.by.toLowerCase() === String(role).toLowerCase()) {
          console.log("🟢 move分岐(1)");
          // 自分の手なので描画不要（アニメ2回&手番フリップの原因）
          if (!pollingActive) startPolling(800); else queueNextPoll(800);
          return;
        }

        console.log("🟢 move分岐(2)の条件");
        console.log("🟢 window.lastSelfKifuLen = ",window.lastSelfKifuLen);
        console.log("🟢 data.kifu_len = ",data.kifu_len);
          
        // ★ (B) data.by が来ない実装でも、長さで“自分エコー”を推定して弾く
        if (typeof window.lastSelfKifuLen === "number" && data.kifu_len <= window.lastSelfKifuLen) {
          console.log("🟢 move分岐(2)");
          if (!pollingActive) startPolling(800); else queueNextPoll(800);
          return;
        }

        // ★ (C) 既に同じ長さまで受信済みならスキップ（従来ロジック）
        if (clientLen >= data.kifu_len) {
          console.log("🟢 move分岐(3)");
          console.log("🛑 すでに受け取った手なのでスキップ");
          if (!pollingActive) startPolling(800); else queueNextPoll(800);
          dbg?.("pollForOpponentMove skip move");
          return;
        }

        // ★ (D) 二重適用ロック（重複ポーリング/連打での二回描画を防止）
        if (window.__applyingMove) {
          console.log("🟢 move分岐(4)");
          if (!pollingActive) startPolling(400); else queueNextPoll(400);
          return;
        }
        window.__applyingMove = true;

        try {
          console.log("🟢 move分岐(5)");
          console.log("🔴 SHOGI.state.kifuLenClient =", clientLen, " / data.kifu_len =", data.kifu_len);

          showCheckBadge?.(!!data.in_check);

          // 互換：currentKifu が残っている実装向け
          window.currentKifu ??= [];
          window.currentKifu.push({
            from: data.from,
            to: data.to,
            drop: data.drop,
            promote: data.promote,
            by: role === "main" ? "sub" : "main",
          });

          // 先後で座標/盤面を反転
          const firstSide = (typeof first !== "undefined") ? first : firstPlayer;
          let visualFrom = data.from;
          let visualTo   = data.to;
          const promote  = !!data.promote;
          let boardVis   = data.board;

          if (role !== firstSide) {
            console.log("🟢 move分岐(6)");
            if (visualFrom !== null) visualFrom = flipIndex(visualFrom);
            visualTo = flipIndex(visualTo);
            boardVis = flipBoard(data.board);
          }

          await animateMove2(visualFrom, visualTo, boardVis, data.captured, data.winner, promote);
          drawCellNumber?.();

          // ★ (E) “適用し終えた後”にだけ既知の長さを更新
          if (typeof data.kifu_len === "number" && data.kifu_len >= 0) {
            window.__kifuSetReason = "move";
            SHOGI.state.kifuLenClient = data.kifu_len;
          } else {
            window.__kifuSetReason = "move+1";
            SHOGI.state.kifuLenClient = (clientLen) + 1;
          }

          // 相手の手を受け取ったので自分番へ
          isMyTurn = true;
          updateTurnMessage?.("あなたの番です");

          updateUndoButtonAvailability(pickUndoFields(data));

          if (!pollingActive) startPolling(delayMy); else queueNextPoll(delayMy);
          return;

        } finally {
          window.__applyingMove = false;
        }
      }

      // === ★ ここに Undo 追加 ★ ===
      if (data.status === "undo") {
          console.log("🔄 undo received:", data);

          const amIFirst = (role === data.first);
          const boardForView = amIFirst ? data.board : flipBoard(data.board);

          drawBoardFromState2(boardForView, data.captured);
          drawCellNumber?.();

          isMyTurn = (data.turn === role);
          updateTurnMessage(isMyTurn ? "あなたの番です" : "相手が考え中です");

          queueNextPoll(700);
          return;
      }

      // 自分番なら軽い心拍だけ（ただし相手手が来ていないときだけ）
      if (myTurnNow && data.status !== "move") {
        updateUndoButtonAvailability(pickUndoFields(data));
        if (!pollingActive) startPolling(delayMy); else queueNextPoll(delayMy);
        return;
      }

      // ===== 7) 相手待ち =====
      if (data.status === "wait") {
        updateUndoButtonAvailability(pickUndoFields(data));
        if (!pollingActive) startPolling(delayOpp); else queueNextPoll(delayOpp);
        dbg?.("pollForOpponentMove wait");
        return;
      }

      // ===== 8) 自分番：軽い心拍だけ =====
      console.log("🔴 myTurnNow = ",myTurnNow);
      if (myTurnNow) {
        if (!pollingActive) startPolling(delayMy); else queueNextPoll(delayMy);
        return;
      }

      // ===== 9) その他の安全弁 =====
      if (!pollingActive) startPolling(1200); else queueNextPoll(1200);
      dbg?.("pollForOpponentMove other case");
      return;

    } catch (err) {
      console.error("🔥 fetch /get_match_move failed:", err);
      if (!pollingActive) startPolling(2000); else queueNextPoll(2000);
      dbg?.("pollForOpponentMove catch err");
      return;
    }
  }

  function showCheckBadge(on) {
    const el = document.getElementById("check-badge") || (() => {
      const b = document.createElement("span");
      b.id = "check-badge";
      b.className = "check-badge";
      document.getElementById("right-panel-title")?.appendChild(b);
      return b;
    })();
    el.textContent = on ? "王手！" : "";
    el.style.display = on ? "inline-block" : "none";
  }

  // ==== 共通：終局処理 ====
  function finalizeEndGame({ reason, message, payload } = {}) {
    try {
      if (gameOver && inPostGame) {
        console.log(`[END] skip: already finalized (${reason})`);
        return;
      }
      // フラグ統一
      gameOver   = true;
      inPostGame = true;
      window.isResetting = false;          // リセット系とは排他

      // ポーリング停止（通常/終局心拍の順で整理）
      stopPolling?.();
      // 終局心拍はこの後に再起動するので、既存のを念のため止めてから…
      stopPostGameHeartbeat?.();

      // UI更新
      updateTurnMessage?.(message || "対局終了");
      document.getElementById("btn-resign-pvp")?.setAttribute("disabled","disabled");

      // リセット関連UIの残骸は掃除（冪等）
      hasShownResetRequest = false;
      document.getElementById("reset-request-area")?.remove();
      document.getElementById("accept-reset-btn")?.remove();
      document.getElementById("opponent-comment-line")?.remove();
      lastOpponentComment = null;

      // 「対局終了（リセット）」ラベルに切替
      setupResetButtonForState?.();

      // 低頻度の終局心拍を開始（初期盤/再開を待つ）
      startPostGameHeartbeat?.(1500);

      console.log(`[END] finalized: reason=${reason}`, payload ?? {});
    } catch (e) {
      console.warn("finalizeEndGame error:", e);
    }
  }

  // ==== 投了 ====
  function finalizeByResign(info) {
    // resigner の同定（ID優先→role名フォールバック）
    const rid = info?.resigner_id ?? info?.resignerId ?? info?.resignerID ?? null;
    const resignedMe = rid
      ? String(rid) === String(playerId)
      : (typeof info?.resigner === "string" &&
         info.resigner.toLowerCase() === String(role).toLowerCase());

    const message = resignedMe
      ? "対局終了：あなたが投了しました"
      : "対局終了：相手が投了しました";

    finalizeEndGame({
      reason: "resign",
      message,
      payload: info
    });
  }

  // ==== 詰み ====
  function finalizeByCheckmate(info) {
    // winner の同定（"main"/"sub" を想定）
    const w = (info?.winner || "").toLowerCase(); // "main" / "sub"
    const iWon = w && w === String(role).toLowerCase();

    const message = iWon
      ? "詰み：あなたの勝ちです"
      : "詰み：相手の勝ちです";

    finalizeEndGame({
      reason: "checkmate",
      message,
      payload: info
    });
  }

  // ★ ボタンの挙動とラベルを局面で切り替える
  function setupResetButtonForState() {
    const resetBtn = document.getElementById("btn-reset");
    if (!resetBtn) return;

    const ended = !!(gameOver || inPostGame);
    console.log("❌[AFTER RESET] gameOver=", gameOver, "inPostGame=", inPostGame);

    // 1) 文言は常に更新（サブ側でも揺れない）
    resetBtn.textContent = ended ? "対局終了（リセット）" : "リセット要求";

    // 2) ハンドラを一旦クリア（多重バインド防止）
    resetBtn.onclick = null;

    // 3) main だけ操作可。サブは表示だけ更新して disable
    if (role === "main") {
      resetBtn.removeAttribute("disabled");

      if (ended) {
        // 終局中は即リセットAPI
        resetBtn.onclick = () => {
          // 連打防止
          if (resetBtn.dataset.busy === "1") return;
          resetBtn.dataset.busy = "1";
          // 投了で心拍が動いている想定 → リセット時に止める
          stopPostGameHeartbeat?.();
          Promise.resolve(forceResetMatch({ swapFirst: false }))
            .finally(() => { delete resetBtn.dataset.busy; });
        };
        resetBtn.title = "新規対局を開始します（メインのみ）";
      } else {
        // 対局中は「要求→承諾」フロー
        resetBtn.onclick = () => requestResetWithComment(); // ← 実行ではなく“関数参照”を渡す
        resetBtn.title = "サブにリセット要求を送ります（メインのみ）";
      }
    } else {
      resetBtn.setAttribute("disabled", "disabled");
      resetBtn.title = "この操作はメイン側のみ可能です";
    }
  }


  // mainだけの機能
  async function forceResetMatch({ swapFirst = false } = {}) {
    try {
      const res = await fetch("/force_reset_match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: mainId, sub: subId, swap_first: swapFirst, id: playerId })
      });
      const data = await res.json();
      if (!data.ok) {
        alert("リセット失敗: " + (data.message || ""));
        return;
      }

      initGlobal();
      // 投了心拍を停止
      stopPostGameHeartbeat?.();

      if (data.first) firstPlayer = data.first;

      // ... fetch OK の後、描画の直前か直後に
      resetLocalKifu();            // ★ ここで必ず0に
      await fetchAndDrawMatchBoard();
      window.lastSelfKifuLen = SHOGI.state.kifuLenClient;      // ★ 念押し（=0）

      inPostGame = false; gameOver = false;
      setupResetButtonForState?.(); // ← フラグ更新後に呼ぶ

      document.getElementById("btn-resign-pvp")?.removeAttribute("disabled");

      if (!pollingActive) startPolling(isMyTurn ? 900 : 600);
      else queueNextPoll?.(0);

    } catch (e) {
      alert("リセット通信エラー: " + e.message);
    }
  }
  
  function pollForReset() {
    setInterval(() => {
      fetch("/check_match_reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: mainId, sub: subId })
      })
      .then(res => res.json())
      .then(data => {
        if (data.reset) {
          console.log("🔁 リセットを検知 → サブ側も waitForGameStart を再実行");
          waitForGameStart();
        }
      });
    }, 2000); // 2秒ごとにチェック
  }

  async function requestResetWithComment() {
    if (!isMyTurn) {
      alert("この操作はあなたの番の時しか行えません");
      return;
    }
    const btn = document.getElementById("request-reset-btn");
    const commentBox = document.getElementById("main-comment-box");
    const comment = (commentBox?.value || "").trim();

    pollCounter = 0;

    try {
      // 二重送信防止
      if (btn) btn.disabled = true;

      const res = await fetch("/request_reset_match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          main: mainId,
          sub: subId,
          role: role,      // 送ってOK
          comment: comment // 空でも可
        })
      });

      const data = await res.json();

      if (data.status === "ok") {
        dbg("requestResetWithComment after ok");
        fromWhere = "requestResetWithComment";
        window.isResetting = true;
        // ブロッキングな alert はやめて、ログ表示に変更
        const commentLog = document.getElementById("comment-log");
        if (commentLog) {
          commentLog.innerHTML += `<div>🔁 リセット要求を送信しました: ${comment || "（コメントなし）"}</div>`;
        }
        if (commentBox) commentBox.value = "";

        if (!pollingActive) startPolling(0); else queueNextPoll(0);

      } else {
        // 失敗時
        const msg = `リセットリクエストに失敗しました: ${data.message || "unknown error"}`;
        console.error(msg);
        const commentLog = document.getElementById("comment-log");
        if (commentLog) commentLog.innerHTML += `<div style="color:red">⚠ ${msg}</div>`;
        if (btn) btn.disabled = false; // もう一度押せるように
      }
    } catch (err) {
      console.error("リセットリクエスト送信中にエラー:", err);
      const commentLog = document.getElementById("comment-log");
      if (commentLog) commentLog.innerHTML += `<div style="color:red">⚠ 送信エラー: ${String(err)}</div>`;
      if (btn) btn.disabled = false;
      // ネットワーク一時不良を想定して軽く再試行
      if (pollingActive) queueNextPoll(2000); else startPolling(2000);
    }
  }

  function acceptReset() {
    console.log("✅ リセット承諾ボタンが押されました");

    // 空の盤面を表示（視覚的にリセットした感を出す）
    drawEmptyBoard2();

    console.log("🟢 window.isResetting before initGlobal = ",window.isResetting);

    //グローバル変数の初期化
    initGlobal();
    window.isResetting = false;

    console.log("🟢 window.isResetting after initGlobal = ",window.isResetting);

    if (role === "main") {
      // 相手IDや先手表示に使う値を渡す（お持ちの変数に合わせて）
      showMatchPanelAsMain(subId ?? sub, first);
    } else {
      showMatchPanelAsSub(mainId ?? main, first);
    }

    if (role === "sub") {
      // started:true になるまでチェック
      if (typeof waitForGameStart === "function") waitForGameStart();
    }

    fetch("/accept_reset_request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        main: mainId,
        sub: subId,
        role: role
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === "ok") {
          alert("リセットを承諾しました");

        } else {
          alert("⚠ リセット通知に失敗: " + data.message);
        }
      });
  }

  function saveKifu2() {
    const doSave = confirm("棋譜を保存しますか？（キャンセルでスキップ）");
    if (doSave) {
      const payload = {
        main: typeof mainId !== "undefined" ? mainId : null,
        sub:  typeof subId  !== "undefined" ? subId  : null,
        requester: typeof role !== "undefined" ? role : null, // "main" or "sub"
        userId: typeof playerID !== "undefined" ? playerID : null, // フォールバック用
      };

      fetch("/save_kifu2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            alert(`棋譜を保存しました: ${data.filename}`);
          } else {
            alert(`保存に失敗しました：${data.error || "不明なエラー"}`);
          }
        })
        .catch(err => {
          console.error("保存エラー:", err);
          alert("保存中にエラーが発生しました。");
        });
    }
  }

  // ▼ 終局中のみ使う心拍ポーリング
  function startPostGameHeartbeat(interval = 1500) {
    if (postGameTimer) return;

    postGameTimer = setInterval(async () => {
      try {
        const res = await fetch("/get_match_board", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ main: mainId, sub: subId, player: role }) // ← player を送る
        });
        const d = await res.json();
        if (d.status !== "ok") return;

        const boardArr = Array.isArray(d.board) ? d.board : null;
        if (!boardArr) return;

        // ===== ここが重要：復帰条件の厳格化 =====
        // サーバが返せるキーのうち、まずは winner / kifu_len を見る
        const winnerKnown = typeof d.winner !== "undefined" && d.winner !== null;
        const kifuKnown   = typeof d.kifu_len === "number";

        // reset_epoch を見られるなら採用（初回は記録だけ）
        if (typeof d.reset_epoch === "number" && seenResetEpoch === null) {
          seenResetEpoch = d.reset_epoch;
        }
        const epochChanged = (typeof d.reset_epoch === "number" && seenResetEpoch !== null && d.reset_epoch !== seenResetEpoch);

        const phaseInit = d.phase === "init";
        const resetDetected =
          epochChanged ||
          phaseInit ||
          (!winnerKnown && kifuKnown && d.kifu_len === 0);  // ← winner消失 & 棋譜0

        if (!resetDetected) {
          // ★ 終局中は UI をいじらない（手番メッセージも更新しない）
          //   ラベルが揺れないよう、setupResetButtonForState も呼ばない
          return;
        }
        // ===== 復帰確定：以降は通常モードへ =====
        seenResetEpoch = (typeof d.reset_epoch === "number") ? d.reset_epoch : seenResetEpoch;

        stopPostGameHeartbeat();

        // ここで初めて終局解除
        inPostGame = false;
        gameOver   = false;

        // 先後の更新と描画
        if (d.first) firstPlayer = d.first;
        const visBoard = (role === firstPlayer) ? boardArr : flipBoard(boardArr);
        drawBoardFromState2(visBoard, d.captured ?? { main: [], sub: [] });

        // 手番計算（どれかがあればOK）
        let nextTurn = null;
        if (typeof d.isMyTurn === "boolean") nextTurn = d.isMyTurn;
        else if (typeof d.is_my_turn === "boolean") nextTurn = d.is_my_turn;
        else if (d.turn) nextTurn = (role === firstPlayer) ? (d.turn === "main") : (d.turn === "sub");
        else nextTurn = (role === firstPlayer);

        isMyTurn = !!nextTurn;
        updateTurnMessage(isMyTurn ? "あなたの番です" : "相手が考え中です");

        setupResetButtonForState?.();
        //enableBoardUI?.();
        document.getElementById("btn-resign-pvp")?.removeAttribute("disabled");

        if (!pollingActive) startPolling(isMyTurn ? 900 : 600);
        else queueNextPoll?.(0);

      } catch (e) {
        console.warn("postGame heartbeat err:", e?.message);
      }
    }, interval);
  }

  function stopPostGameHeartbeat() {
    console.log("❌ stopPostGameheartbeat:start");
    if (postGameTimer) {
      clearInterval(postGameTimer);
      postGameTimer = null;
    }
    // 状態に応じてリセットボタンの表示状態を整える
    try { setupResetButtonForState?.(); } catch {}
  }

  /**
   * 盤とボタンの操作を“対局中モード”に戻す。
   * - 冪等：何度呼んでもOK
   * - drawBoardFromState2 で innerHTML を入れ替えても動くよう、イベントは委譲で1本化
   */
  function enableBoardUI() {
    uiDisabled = false;

    // 1) 「AI 考え中」などのバナーは消す
    const thinking = document.getElementById("thinking-banner");
    if (thinking) thinking.style.display = "none";

    // 2) 盤と駒台をクリック可能に
    const boardEl = document.getElementById("board");
    const myCap  = document.getElementById("captured-pieces-self");
    const oppCap = document.getElementById("captured-pieces-opponent");


    [boardEl, myCap, oppCap].filter(Boolean).forEach(el => {
      el.classList.remove("ui-disabled");
      el.style.pointerEvents = "auto";
      el.setAttribute("aria-disabled", "false");
    });

    // 3) 盤クリックのイベント委譲（多重バインド防止）
    if (boardEl) {
      // 既存のハンドラを外して付け直す（冪等）
      if (boardEl._onClickRef) {
        boardEl.removeEventListener("click", boardEl._onClickRef);
      }
      
      // ブロック条件：終局中/ポストゲーム中/サーバリセット中/相手番
      //const resetting = (typeof window.isResetting !== "undefined") && window.isResetting === true;
      if (uiDisabled)  { console.log("⛔ click-block: uiDisabled"); return; }
      if (inPostGame)  { console.log("⛔ click-block: inPostGame"); return; }
      if (gameOver)    { console.log("⛔ click-block: gameOver");   return; }
      //if (resetting)   { console.log("⛔ click-block: resetting");  return; }
      if (!isMyTurn)   { console.log("⛔ click-block: not my turn"); return; }

      //if (uiDisabled || inPostGame || gameOver || resetting) return;
      if (uiDisabled || inPostGame || gameOver ) return;
      if (!isMyTurn) {
        // クリック無効時の軽いフィードバック（任意）
        // boardEl.classList.add("pulse-not-myturn"); setTimeout(()=>boardEl.classList.remove("pulse-not-myturn"), 200);
        return;
      }

      // enableBoardUI 内の boardEl._onClickRef を次のように
      boardEl._onClickRef = (ev) => {
     
        const cell = ev.target.closest(".cell");
        if (!cell) return;

        // 既存のセルクリック処理に委譲
        if (typeof handleCellClick === "function") {
          handleCellClick(cell);
        } else if (typeof handleCellClick2 === "function") {
          handleCellClick2(cell);
        }
      };
      boardEl.addEventListener("click", boardEl._onClickRef, { passive: true });
    }

    // 4) 投了ボタンの有効/無効
    const resignBtn = document.getElementById("btn-resign-pvp");
    if (resignBtn) {
      if (!inPostGame && !gameOver) {
        resignBtn.removeAttribute("disabled");
      } else {
        resignBtn.setAttribute("disabled", "disabled");
      }
    }

    // 5) リセットボタンの表示と挙動を現在状態に合わせて反映
    setupResetButtonForState?.();
  }

  /* 補助：無効化が必要な場面用（AI思考中・サーバ更新中など） */
  function disableBoardUI({ showThinking = false } = {}) {
    uiDisabled = true;

    const thinking = document.getElementById("thinking-banner");
    if (thinking) thinking.style.display = showThinking ? "block" : "none";

    const boardEl = document.getElementById("board");
    const myCap   = document.getElementById("my-captured");
    const oppCap  = document.getElementById("opp-captured");

    [boardEl, myCap, oppCap].filter(Boolean).forEach(el => {
      el.classList.add("ui-disabled");
      el.style.pointerEvents = "none";
      el.setAttribute("aria-disabled", "true");
    });
  }

  // 共有状態（未導入なら）
  window.SHOGI ??= {};
  SHOGI.state ??= {};
  SHOGI.state.kifuLenClient ??= 0;

  // 旧: window.currentKifu を使っていたなら存在させる
  window.currentKifu ??= [];

  // ローカル棋譜を初期化する関数（どこからでも呼べるように）
  function resetLocalKifu() {
    window.SHOGI ??= {}; (SHOGI.state ??= {}).kifuLenClient = 0;
    window.currentKifu ??= []; window.currentKifu.length = 0;
    window.lastSelfKifuLen = 0;               // ★ これを必ずゼロに！
  
    SHOGI.state.kifuLenClient = 0;
    if (Array.isArray(window.currentKifu)) {
      window.currentKifu.length = 0; // 既存配列を空に
    } else {
      window.currentKifu = [];
    }
    // 必要なら直近手などもリセット
    // window.lastMove = null;
  }

  // サーバ応答を受けたときに“kifu長”を同期する補助
  function syncKifuLenFromServer(d) {
    if (typeof d?.kifu_len === "number") {
      SHOGI.state.kifuLenClient = d.kifu_len;
    }
  }

  async function undoLastMove() {
    const btn = document.getElementById("btn-undo");
    if (btn) btn.disabled = true;

    try {
      const res = await fetch("/undo_last_move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main: mainId, sub: subId, role })
      });
      const d = await res.json();
      if (d.status !== "undo") {
        alert(d.message || "一手戻しに失敗しました");
        return;
      }

      // 先手視点の board が来る → 自分が先手ならそのまま、後手なら flip
            // ---- ここから置き換え ----

      // 先手情報だけは更新（fetchAndDrawMatchBoard 内でも使うので）
      if (d.first) firstPlayer = d.first;

      // 盤面はサーバ側の正式状態を取り直して描画
      await fetchAndDrawMatchBoard();

      // Undo 後の手番（サーバからもらった turn）
      isMyTurn = (d.turn === role);
      updateTurnMessage(isMyTurn ? "あなたの番です" : "相手が考え中です");

      // ローカルの kifuLen もサーバ値に合わせる（余裕があれば）
      window.SHOGI ??= {}; (SHOGI.state ??= {});
      SHOGI.state.kifuLenClient = d.kifu_len ?? SHOGI.state.kifuLenClient ?? 0;
      window.lastSelfKifuLen    = SHOGI.state.kifuLenClient;
      if (Array.isArray(window.currentKifu)) {
        currentKifu.length = SHOGI.state.kifuLenClient;
      }

      // 次のポーリングへ
      updateUndoButtonAvailability(d);
      if (!pollingActive) startPolling(isMyTurn ? 900 : 600);
      else queueNextPoll?.(0);

    } catch (e) {
      console.error("undoLastMove error:", e);
      alert("通信エラー: " + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function pickUndoFields(d = {}) {
    // last_by が来ない API でも currentKifu から推定できるようにフォールバック
    const localLastBy =
      Array.isArray(window.currentKifu) && window.currentKifu.length
        ? window.currentKifu[window.currentKifu.length - 1].by
        : null;

    const localLen =
      typeof SHOGI?.state?.kifuLenClient === "number"
        ? SHOGI.state.kifuLenClient
        : (Array.isArray(window.currentKifu) ? window.currentKifu.length : 0);

    return {
      last_by: d.last_by ?? localLastBy ?? null,
      finished: !!d.finished,
      kifu_len: (typeof d.kifu_len === "number") ? d.kifu_len : localLen,
    };
  }

  window.startGame2 = startGame2;
  window.resetGame2 = resetGame2;
  window.saveKifu2 = saveKifu2;
  window.resignGame2 = resignGame2;
  window.updateRightPanel = updateRightPanel;
  window.returnToMainMenu2 = returnToMainMenu2;
  //window.sendComment = sendComment; 
  window.animateMove2 = animateMove2;
  window.handleCellClick2 = handleCellClick2;
  window.pollUntilFirstMove = pollUntilFirstMove;
  window.pollForOpponentMove = pollForOpponentMove;
  window.requestResetWithComment = requestResetWithComment;
  window.fetchAndDrawMatchBoard = fetchAndDrawMatchBoard;
  window.acceptReset = acceptReset;
  window.drawInitialBoard = drawInitialBoard;
  window.forceResetMatch = forceResetMatch;
  window.startPostGameHeartbeat = startPostGameHeartbeat;
  window.stopPostGameHeartbeat = stopPostGameHeartbeat;
  window.enableBoardUI = enableBoardUI;
  window.disableBoardUI = disableBoardUI;
});
