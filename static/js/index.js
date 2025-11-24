document.addEventListener("DOMContentLoaded", () => {
  console.log("✅ index.js loaded");

  let selectedPiece = null;
  let selectedCell = null;
  let currentTurn = "player";
  let selectedHandPiece = null; // 駒台から選ばれた駒（打ち込み用）
  let gameStarted = false;
  let gameMode = "";
  let autoReplayTimer = null;
  let replayMode = false;
  let captured_by_player = [];
  let captured_by_ai = [];
  let selectedAIType = "simple";
  let selectedHandPieceElement = null;
  let kifu = null;
  let aiType = "simple"; // グローバル変数として宣言
  let isAIThinking = false;
  let playerID = "";
  let loginFlag = false;
  let pollingTimer = null;  // グローバル変数として宣言
  let pollingInterval = null;

  // 再生用の状態は window に一本化
  window.replayMoves  = window.replayMoves  || [];
  window.replayIndex  = (typeof window.replayIndex === "number") ? window.replayIndex : 0;

  // === USI<->漢字 変換マップ（唯一の正） ===
  const usiToKanjiMap = {
    P:"歩", L:"香", N:"桂", S:"銀", G:"金", B:"角", R:"飛", K:"玉",
      "+P":"と", "+L":"杏", "+N":"圭", "+S":"全", "+B":"馬", "+R":"竜"
  };
  const kanjiToUsiMap = Object.fromEntries(
    Object.entries(usiToKanjiMap).map(([u,k]) => [k,u])
  );
  const toKanji = (usi)   => usiToKanjiMap[usi]   ?? usi;
  const toUsi   = (kanji) => kanjiToUsiMap[kanji] ?? kanji;

  // 先手情報を必ず window（globalThis）に載せる
  globalThis.first = globalThis.first ?? 'player';  // 'player' or 'ai'

  // 先手判定＆盤反転ヘルパ
  function isPlayerFirst() { return globalThis.first === 'player'; }
  function toActualIndex(idx) { return isPlayerFirst() ? idx : flipIndex(idx); }

  const createPiece = (piece, isAI = false, forCaptured = false) => {
    const wrapper = document.createElement("div");
    wrapper.className = "piece-wrapper";

    if (isAI) {
      wrapper.classList.add("ai-piece");
    }

    const inner = document.createElement("div");
    inner.className = "piece";

    let pieceToDisplay = piece;

    // --- 打ち込み記号の処理（*P → P） ---
    if (typeof pieceToDisplay === "string" && pieceToDisplay.startsWith("*")) {
      pieceToDisplay = pieceToDisplay.substring(1);
    }

    // --- ここで必ずUSI→漢字の変換を試みる ---
    pieceToDisplay = toKanji(pieceToDisplay);

    // --- 表示 ---
    inner.innerText = pieceToDisplay;

    if (!isAI) {
      wrapper.onclick = () => {
        if (selectedHandPiece === pieceToDisplay) {
          selectedHandPiece = null;
          wrapper.classList.remove("selected");
        } else {
          document.querySelectorAll("#captured-pieces-player .piece-wrapper").forEach(w => {
            w.classList.remove("selected");
          });
          selectedHandPiece = pieceToDisplay;
          selectedPiece = null;
          wrapper.classList.add("selected");
        }
      };
    }

    wrapper.appendChild(inner);
    return wrapper;
  };

  // 上の方に sleep 関数を追加
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function parseMoveString(moveStr) {
    const fileMap = { "1": 8, "2": 7, "3": 6, "4": 5, "5": 4, "6": 3, "7": 2, "8": 1, "9": 0 };
    const rankMap = { "a": 0, "b": 1, "c": 2, "d": 3, "e": 4, "f": 5, "g": 6, "h": 7, "i": 8 };

    if (!moveStr || moveStr.length < 4) {
      return { from: null, to: null };
    }

    // 🔽 打ち込み形式（例: "P*2c"）
    if (moveStr.includes("*")) {
      const parts = moveStr.split("*");
      const toFile = fileMap[parts[1][0]];
      const toRank = rankMap[parts[1][1]];

      if (toFile === undefined || toRank === undefined) {
        return { from: null, to: null };
      }

      const to = toRank * 9 + toFile;
      return { from: null, to };
    }

    // 🔽 通常手（例: "2c2d"）
    const fromFile = fileMap[moveStr[0]];
    const fromRank = rankMap[moveStr[1]];
    const toFile = fileMap[moveStr[2]];
    const toRank = rankMap[moveStr[3]];

    if (
      fromFile === undefined || fromRank === undefined ||
      toFile === undefined || toRank === undefined
    ) {
      return { from: null, to: null };
    }

    const from = fromRank * 9 + fromFile;
    const to = toRank * 9 + toFile;

    return { from, to };
  }

  function unpromotePiece(piece) {
    // 成りを元に戻す（駒台用）
    if (piece.startsWith("+")) {
      return piece.substring(1);  // "+P" → "P"
    }
    return piece;
  }

  function highlightMove(from, to, board) {
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
    let piece = board[Math.floor(to / 9)][to % 9];  // 例: "*今" または "桂" など

    // 先頭の *（AI駒）を取り除く
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

  function highlightMove2(from, to) {
    const highlightCells = [];

    const toRow = Math.floor(to / 9);
    const toCol = to % 9;

    const toCell = document.querySelector(`.cell[data-row='${toRow}'][data-col='${toCol}']`);

    if (from === null) {
      if (toCell) {
        //console.log("🔴 クラス追加前:", toCell.className);
        toCell.classList.add("highlight-drop");
        //console.log("🟢 クラス追加後:", toCell.className);
        highlightCells.push(toCell);
      }
    } else {
      // 🔽 通常の駒移動
      const fromRow = Math.floor(from / 9);
      const fromCol = from % 9;

      const fromCell = document.querySelector(`.cell[data-row='${fromRow}'][data-col='${fromCol}']`);
      if (fromCell) {
        fromCell.classList.add("highlight-from");
        highlightCells.push(fromCell);
      }

      if (toCell) {
        toCell.classList.add("highlight-to");
        highlightCells.push(toCell);
      }

      // 間のセルのハイライト（桂馬を除く）縦方向：Row、横方向：Col
      const dy = toRow - fromRow;
      const dx = toCol - fromCol;
        
      const dRow = Math.sign(dy);
      const dCol = Math.sign(dx);

      // 桂馬の場合はパス
      if ((dx == 1 || dx==-1) && (dy==2 || dy==-2)){
        return highlightCells;
      }

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

  function clearHighlights() {
    document.querySelectorAll(".highlight-from, .highlight-to, .highlight-middle, .highlight-drop")
      .forEach(cell => cell.classList.remove("highlight-from", "highlight-to", "highlight-middle", "highlight-drop"));
  }

  async function fetchBoardState() {
    const response = await fetch(`/get_board?player_id=${playerID}`);
    const data = await response.json();

    if (data.error) {
      alert("❌ " + data.error);
      return;
    }

    // board描画などへ
    updateBoardUI(data.board, data.captured, data.turn);
  }

  function drawBoardFromState(board, captured) {
    console.log("🔺drawBoardFromState A");
    const boardElement = document.getElementById("board");
    boardElement.innerHTML = ""; // 盤面クリア

    const promotedChars = ["と", "杏", "圭", "全", "馬", "竜"];

    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        const index = row * 9 + col;
        cell.dataset.index = index;
        cell.dataset.row = row;
        cell.dataset.col = col;

        // 🔢 セル番号（左上に小さく表示）
        const coord = document.createElement("div");
        coord.className = "cell-debug";
        coord.innerText = index;
        cell.appendChild(coord);

        const piece = board[row][col];
        if (piece) {
          const pieceWrapper = document.createElement("div");
          pieceWrapper.className = "piece-wrapper";

          const pieceElement = document.createElement("div");
          pieceElement.className = "piece";

          let pieceToDisplay = piece;
          let isAI = false;

          if (piece.startsWith("*")) {
            isAI = true;
            pieceToDisplay = piece.substring(1);
          }

          if (pieceToDisplay.startsWith("+") || promotedChars.includes(pieceToDisplay)) {
            pieceElement.classList.add("promoted");
          }

          //pieceElement.innerText = usiToKanji[pieceToDisplay] || pieceToDisplay;
          pieceElement.innerText = toKanji(pieceToDisplay);

          if (isAI) {
            pieceWrapper.classList.add("ai-piece");
          }

          pieceWrapper.appendChild(pieceElement);
          cell.appendChild(pieceWrapper);
        }

        // ★クリック処理を付与
        cell.onclick = () => handleCellClick(cell);

        boardElement.appendChild(cell);
      }
    }

    // 駒台を更新
      updateCapturedPieces(captured);
  }

  function updateCapturedPieces(captured) {
    const playerCapturedDiv = document.getElementById("captured-pieces-player");
    const aiCapturedDiv = document.getElementById("captured-pieces-ai");

    playerCapturedDiv.innerHTML = "";
    aiCapturedDiv.innerHTML = "";

    if (captured?.player && Array.isArray(captured.player)) {
      captured.player.forEach(piece => {
        playerCapturedDiv.appendChild(createPiece(unpromotePiece(piece), false));
      });
    }

    if (captured?.ai && Array.isArray(captured.ai)) {
      captured.ai.forEach(piece => {
        aiCapturedDiv.appendChild(createPiece(unpromotePiece(piece), true, true)); // forCaptured = true
      });
    }
  }

  async function handleCellClick(cell) {
    if (isAIThinking) return; // 🔸 AI思考中は何も処理しない
    const clickedIndex = parseInt(cell.dataset.index);

    // --- 駒台からの打ち込み処理（先にチェック） ---
    if (selectedHandPiece !== null) {
      const dropPiece = selectedHandPiece;
      const payload = {
        from: null,
        to: clickedIndex,
        piece: dropPiece,
        promote: false,
        player_id: playerID
      };
      await sendPlayerMove(payload, true);
      selectedHandPiece = null;
      return;
    }

    // --- 1回目のクリック：駒の選択 ---
    if (selectedPiece === null) {
      const pieceElement = cell.querySelector(".piece");
      if (!pieceElement) return; // 空セルクリックは無視

      const pieceText = pieceElement.innerText;

      // 自分の駒だけ選択可能（AIの駒は除外）
      if (cell.querySelector(".ai-piece")) return; // AIの駒があるセルは無視

      selectedPiece = cell;
      selectedCell = cell;
      selectedPiece.classList.add("selected");
      return;
    }

    // --- 同じ駒をもう一度クリックした場合：キャンセル処理 ---
    if (cell === selectedPiece) {
      selectedPiece.classList.remove("selected");
      selectedPiece = null;
      selectedCell = null;
      return;
    }

    // --- 2回目のクリック：移動先の選択 ---
    const fromIndex = parseInt(selectedCell.dataset.index);
    const toIndex   = clickedIndex;

    const pieceElement = selectedPiece.querySelector(".piece");
    const movingPieceName = pieceElement ? pieceElement.innerText : "";
    const promotable = new Set(["歩","香","桂","銀","飛","角"]);

    // 実局面の index/段に変換
    const sendFrom = toActualIndex(fromIndex);
    const sendTo   = toActualIndex(toIndex);
    const rFrom = Math.floor(sendFrom / 9);
    const rTo   = Math.floor(sendTo   / 9);

    let isPromotion = false;
    if (promotable.has(movingPieceName)) {
      const meFirst   = isPlayerFirst();
      const enemyZone = meFirst ? [0,1,2] : [6,7,8];
      const enemyLast = meFirst ? 0 : 8;
      const enemyLast2= meFirst ? new Set([0,1]) : new Set([7,8]);

      // 成れる：from または to が敵陣
      const canPromote =
        enemyZone.includes(rFrom) || enemyZone.includes(rTo);

      // 強制成り：歩/香→最終段、桂→最終2段
      const mustPromote =
        ((movingPieceName === "歩" || movingPieceName === "香") && rTo === enemyLast) ||
        (movingPieceName === "桂" && enemyLast2.has(rTo));

      if (canPromote) {
        isPromotion = mustPromote ? true : confirm("成りますか？");
      }
    }

    const promote = isPromotion;  // ← このフラグを送信 payload に入れる

    // → /submit_move 送信時の payload に { promote } を載せる
    const payload = {
      from: fromIndex,
      to: toIndex,
      promote: isPromotion,
      player_id: playerID  
    };

    await sendPlayerMove(payload, false);

    // 選択解除
    selectedPiece.classList.remove("selected");
    selectedPiece = null;
    selectedCell = null;
  }

  async function sendPlayerMove(payload, isDrop = false) {
    const response = await fetch("/player_move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.error) {
      alert("❌ " + data.error);
      return;
    }

    console.log("🟠board at sendPlayerMove before anime = ",data.board,"from=",payload.from);

    const from = isDrop ? null : payload.from;
    await animateMove(from, payload.to, data.board, data.captured);

    console.log("🟠board at sendPlayerMove after anime = ",data.board,"from=",from);

    // ✅ サーバーの返答に "turn": "ai" があれば、AIに手番を渡す
    if (data.turn === "ai") {
      console.log("🧠 AIの手番に切り替えます");
      await requestAIMove();
    } else {
      console.log("👤 プレイヤーの手番継続");
    }
  }

  async function requestAIMove() {
    isAIThinking = true;

    const aiType = document.getElementById("ai-type-selector")?.value || "simple";

    // ⭐ バナー表示
    const banner = document.getElementById("thinking-banner");
    if (banner) {
      banner.style.display = "block";
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    try {
      const response = await fetch("/ai_move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai_type: aiType,
          player_id: playerID
        })
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("❌ サーバーエラー:", text);
        alert("AI通信エラー: サーバーが失敗応答を返しました。");
        return;
      }

      const data = await response.json();

      console.log("🟢 after response.json at requestAIMove:", data);

      // ✅ 詰み処理（勝者に応じて分岐）
      if (data.status === "checkmate") {
        if (data.winner === "player") {
          alert("詰みました！あなたの勝ちです！");
          handleGameOver("player");
        } else if (data.winner === "ai") {
          alert("詰まされました！AIの勝ちです！");
          handleGameOver("ai");
        } else {
          alert("詰みですが勝者不明です");
          handleGameOver("unknown");
        }
        return; // 詰みならここで終了
      }

      if (data.error) {
        alert("AIエラー: " + data.error);
        return;
      }

      if (data.is_check) {
        alert("⚠ AIに王手されました！");
      }

      await animateMove(data.from, data.to, data.board, data.captured);
      currentTurn = "player"; 

    } finally {
      isAIThinking = false;
      if (banner) banner.style.display = "none";
    }
  }

  async function animateMove(from, to, board, captured, winner = null, fromElement = null) {

    const fromRow = from !== null ? Math.floor(from / 9) : null;
    const fromCol = from !== null ? from % 9 : null;
    const toRow = Math.floor(to / 9);
    const toCol = to % 9;

    const highlightCells = [];

    console.log("🟠from=",from,"🟠to=",to,"🟠board=",board);

    if (from !== null) {

      // ⭐ ハイライトを取得
      const highlightCells = highlightMove(from, to, board);

      await sleep(500);

      drawBoardFromState(board, captured);

      captured_by_player = captured?.player ?? [];
      captured_by_ai = captured?.ai ?? [];

      updateCapturedPieces({
        player: captured?.player ?? [],
        ai: captured?.ai ?? []
      });

      // ⭐ 再度ハイライト（新たに追加）
      const reHighlightedCells = highlightMove(from, to, board);

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

      drawBoardFromState(board, captured);

      captured_by_player = captured?.player ?? [];
      captured_by_ai = captured?.ai ?? [];

      updateCapturedPieces({
        player: captured?.player ?? [],
        ai: captured?.ai ?? []
      });

      toCell = document.querySelector(`.cell[data-row='${toRow}'][data-col='${toCol}']`);
      if (toCell) toCell.classList.add("highlight-drop");

      await sleep(1000)

      if (toCell) toCell.classList.remove("highlight-drop");
    }
    //await sleep(1000);
  }

  function handleGameOver(winner) {
    if (!winner) return;

    console.log("勝敗表示");
    document.getElementById("message-box").innerText =
      winner === "player"
        ? "詰みました　あなたの勝ちです！"
        : "詰まされました！AIの勝ちです！";

    gameStarted = false;
    currentTurn = "none";
  }

  async function startGame() {
    mode = "game";
    //const playerId = document.getElementById("player-id").value.trim();
    const aiType = document.getElementById("ai-type-selector").value;
    console.log("🟢aiType=", aiType);
    const side = document.querySelector('input[name="side"]:checked').value;

    drawInitialBoard();

    fetch("/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        first: side,
        player_id: playerID,
        ai_type: aiType
      })
    })
      .then(response => response.json())
      .then(async data => {

        // サーバが返す先手情報に合わせて保存（無ければ 'player'）
        globalThis.first = (data.first /* 'player'|'ai' */) || globalThis.first || 'player';
        console.log('先手 =', globalThis.first);

        const startButton = document.getElementById("start-button");
        startButton.classList.add("playing");

        currentTurn = data.turn;

        console.log("🤖 current turn=", currentTurn);
        gameStarted = true;

        console.log("🔎 AI move request playerID =", playerID);

        console.log("⭕️data from=", data.from, "🔴data to=", data.to, "▶️先手=", side);

        if (side === "player") {
          return;
        }

        // 🔁 直接描画ではなく、requestAIMove() を呼び出すことでバナーなども含め統一
        await requestAIMove();

      });  // ← then() の終了
  }      // ← startGame 関数の終了

  function resetBoard() {
    gameStarted = false;

    // 🔁 ゲーム開始ボタンの初期化
    const startBtn = document.getElementById("start-button");
    startBtn.textContent = "ゲーム開始";
    startBtn.classList.remove("playing");  // ← "playing" クラスを削除
    startBtn.style.backgroundColor = "";   // ← 背景色を元に戻す
    startBtn.disabled = false;

    // 🔁 ラジオボタンの初期化
    document.getElementsByName("side").forEach(radio => {
      radio.disabled = false;
      radio.checked = (radio.value === "player");
    });

    // 🔁 メッセージ欄クリア
    document.getElementById("message-box").innerText = "";

    // 🔁 駒台の初期化
    updateCapturedPieces({ player: [], ai: [] });

    // 🔁 空の盤面を描画
    drawEmptyBoard();

    // 🔁 サーバー側のゲーム状態もリセット
    fetch("/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player_id: playerID })
    })
    .then(res => res.json())
    .then(data => {
      if (!data.success) {
        console.warn("サーバーリセットに失敗:", data);
      } else {
        console.log("✅ サーバー側もリセット済み");
      }
    })
    .catch(err => {
      console.error("リセット通信エラー:", err);
    });
  }
    
  function resignGame() {
    if (!gameStarted) return;

    const confirmResign = confirm("本当に投了しますか？");
    if (!confirmResign) return;

    fetch("/resign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player_id: playerID,
        result: "lose",
        reason: "resign"
      })
    })
      .then(response => response.json())
      .then(data => {
        document.getElementById("message-box").innerText = "あなたの投了により AIの勝ちです。";
        gameStarted = false;
        winner = "ai";  // ← オプションで記録
        checkmate = false;
      })
      .catch(error => {
        console.error("投了処理エラー:", error);
        alert("投了処理中にエラーが発生しました。");
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    fetch("/player_ids")
      .then(response => response.json())
      .then(ids => {
        const datalist = document.getElementById("player-id-list");
        ids.forEach(id => {
          const option = document.createElement("option");
          option.value = id;
          datalist.appendChild(option);
        });
      });
  });

  function showHumanVsAI() {
    gameMode = "humVsAi";
    const panel = document.getElementById("right-panel");
    const valueName = "プレイヤーID";
    console.log("プレイヤーID=",playerID,"login flag=",loginFlag);
    panel.innerHTML = `
      <h3>AIとの対局</h3>
      <div id="player-id"></div><br>

      <label for="ai-type-selector">AIタイプ:</label>
      <select id="ai-type-selector" style="width: 130px; margin-bottom: 10px;">
        <option value="simple">Simple AI</option>
        <option value="minimax">Minimax AI</option>
        <option value="learning">Learning AI</option>
      </select>

      <div>
        <label>先手</label><br>
        <label><input type="radio" name="side" value="player" checked> YOU </label><br>
        <label><input type="radio" name="side" value="ai"> AI </label><br><br>
        <button id="start-button" onclick="startGame()">ゲーム開始</button>
        <button onclick="resetBoard()">リセット</button>
        <button onclick="resignGame()">投了します</button>
      </div>
      <button onclick="saveKifu()">棋譜を保存</button>
      <button onclick="showInitialMenu()">メインメニューに戻る</button>
      <div id="message-box" class="message-box">メッセージがここに表示されます</div>
    `;

    // プレイヤーIDの表示
    document.getElementById("player-id").innerHTML = 
      `<strong>${valueName}</strong>: ${playerID}`;

    // ✅ AIタイプセレクタのイベントバインドも復元
    document.getElementById("ai-type-selector").addEventListener("change", function () {
      selectedAIType = this.value;
      console.log("🎛 対局メニュー復元後の AIタイプ:", selectedAIType);
    });

    // ✅ 盤面を初期化
    resetBoard();
  }

  // 棋譜リストを取得してセレクトを更新
  async function refreshKifuList() {
    const kindSel = document.getElementById("kifu-kind");
    const listSel = document.getElementById("kifu-select");
    if (!kindSel || !listSel) return;

    const kind = kindSel.value || "ai";

    // サーバから一覧を取得（さっき作った /kifu_list?kind=...）
    const res = await fetch(`/kifu_list?kind=${encodeURIComponent(kind)}&limit=200`);
    if (!res.ok) {
      console.error("kifu_list failed:", res.status, res.statusText);
      listSel.innerHTML = "";
      listSel.appendChild(new Option("（取得エラー）", ""));
      listSel.disabled = true;
      return;
    }
    const items = await res.json();

    // セレクト描画
    listSel.innerHTML = "";
    if (!Array.isArray(items) || items.length === 0) {
      listSel.appendChild(new Option("（該当なし）", ""));
      listSel.disabled = true;
      return;
    }
    listSel.disabled = false;

    // ラベルは見やすく、値は再生用に path を入れる
    for (const it of items) {
      const mode = it.mode?.toUpperCase() || "AI";
      const players = Array.isArray(it.players) ? it.players.join(" vs ") : "";
      const label = `[${mode}] ${it.timestamp || ""}  ${players}  (${it.kifu_len ?? 0}手)`;
      const value = it.path || `${it.mode}/${it.filename}`;
      listSel.appendChild(new Option(label, value));
    }
  }

  // 「種別」変更でリスト更新
  document.getElementById("kifu-kind")?.addEventListener("change", refreshKifuList);


  async function loadKifu() {
    const sel =
      document.getElementById("kifu-select") ||
      document.getElementById("kifu-selector");

    const picked = sel?.value || "";
    if (!picked) {
      alert("棋譜ファイルを選択してください");
      return;
    }

    // ▼ 盤面・駒台・変数の初期化（すべて window に）
    drawEmptyBoard();
    updateCapturedPieces({ player: [], ai: [] });
    window.replayMoves = [];
    window.replayIndex = 0;
    window.captured_by_player = [];
    window.captured_by_ai = [];
    window.gameStarted = false;

    let data;
    try {
      if (picked.includes("/")) {
        const r = await fetch("/load_kifu", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: picked })
        });
        if (!r.ok) throw new Error("棋譜ロード失敗 (/load_kifu)");
        data = await r.json();
        if (!(data.status === "ok" || data.success === true)) {
          throw new Error(data.message || "棋譜ロード失敗 (/load_kifu)");
        }
      } else {
        const r = await fetch(`/kifu/${picked}`);
        if (!r.ok) throw new Error("棋譜ファイルが読み込めませんでした (/kifu/filename)");
        data = await r.json();
        data.status = data.status ?? "ok";
        data.path = data.path ?? picked;
      }
    } catch (err) {
      console.error(err);
      alert("棋譜の読み込みに失敗しました");
      return;
    }

    // ▼ 正規化：最終的に window.replayMoves を使う
    const moves = Array.isArray(data.moves) ? data.moves
                : (Array.isArray(data.kifu) ? data.kifu.map(m => m?.usi).filter(Boolean) : []);
    window.replayMoves = moves || [];
    window.replayIndex = 0;

    // ★ 手番情報（YOU/AI or main/sub → player/ai）を kifu.first に格納
    const firstNorm =
      (data.first === "player" || data.first === "YOU" || data.first === "main") ? "player" :
      (data.first === "ai"     || data.first === "AI"  || data.first === "sub")  ? "ai"     :
      null;
    kifu = { first: firstNorm };

    // ▼ 初期局面描画 & ステータス更新
    drawInitialBoard();
    updateReplayStatus?.();

    const msg       = document.getElementById("replay-message");
    const moveCount = window.replayMoves.length;
    const shownName = data.path || picked;

    // ======================================================
    // ★ PVP棋譜の表示
    // ======================================================
    if (data.mode === "pvp") {
      const mainID = data.main || "main";
      const subID  = data.sub  || "sub";

      // 先手
      const firstText =
        (data.first === "main") ? mainID :
        (data.first === "sub")  ? subID  :
        "不明";

      // 勝敗
      let resultText = "不明";
      if (data.winner === "main") resultText = `${mainID} の勝ち`;
      else if (data.winner === "sub") resultText = `${subID} の勝ち`;

      // 理由
      let reasonText = "";
      if (data.reason === "resign")        reasonText = "（投了）";
      else if (data.reason === "checkmate") reasonText = "（詰み）";
      else if (data.reason === "timeout")   reasonText = "（時間切れ）";
      else if (data.reason === "sennichite") reasonText = "（千日手）";

      if (msg) {
        msg.innerHTML =
          `棋譜「${shownName}」を読み込みました（${moveCount}手）。<br>` +
          `ID：main = ${mainID}　sub = ${subID}<br>` +
          `先手：${firstText}　勝敗：${resultText}${reasonText}`;
      }
      return;   // ← AI 用表示には進まない
    }

    // ======================================================
    // ★ ここから AI 対局(従来)の表示
    // ======================================================
    let playerLabel = (typeof playerID !== "undefined" && playerID) ? playerID : "";
    if (!playerLabel && Array.isArray(data.players)) {
      playerLabel = data.players[0] || "";
    }

    let firstText = "不明";
    if (data.first === "player" || data.first === "YOU" || data.first === "main") firstText = "YOU";
    else if (data.first === "ai" || data.first === "AI" || data.first === "sub")  firstText = "AI";

    let resultText = "不明";
    if (data.result === "win")       resultText = "YOUの勝ち";
    else if (data.result === "lose") resultText = "AIの勝ち";
    else if (data.result === "draw") resultText = "引き分け";

    let reasonText = "";
    if (data.reason === "checkmate") reasonText = "（詰み）";
    else if (data.reason === "resign")    reasonText = "（投了）";

    if (msg) {
      msg.innerHTML =
        `棋譜「${shownName}」を読み込みました（${moveCount}手）。<br>` +
        `ID：${playerLabel || "不明"}　先手：${firstText}　勝敗：${resultText}${reasonText}`;
    }
  }

  function fetchKifuList() {
    fetch("/kifu_list")
      .then(res => res.json())
      .then(logs => {
        const selector = document.getElementById("kifu-selector");
        selector.innerHTML = "";
        logs.forEach((log, index) => {
          const option = document.createElement("option");
          option.value = log.filename;
          option.text = `${log.player_id} / ${log.timestamp}（${log.moves.length}手）`;
          selector.appendChild(option);
        });
      });
  }

  function drawEmptyBoard() {
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
        cell.dataset.index = index;

        // デバッグ用ラベル（必要であれば表示）
        const debugLabel = document.createElement("div");
        debugLabel.className = "cell-debug";
        //debugLabel.textContent = `${row},${col}`;
        debugLabel.textContent = `${index}`;  // 0〜80 の連番になる
        cell.appendChild(debugLabel);

        boardElement.appendChild(cell);
      }
    }
  }

  function saveKifu() {

    fetch("/save_kifu", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ player_id: playerID })
    })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          alert("棋譜を保存しました: " + data.filename);
        } else {
          alert("保存に失敗しました。");
        }
      })
      .catch(error => {
        console.error("保存エラー:", error);
        alert("保存中にエラーが発生しました。");
      });
  }

  function startAutoReplay() {
    if (autoReplayTimer) return;

    // 🔴 ボタンを赤背景＋白文字に
    const autoBtn = document.querySelector("button[onclick='startAutoReplay()']");
    if (autoBtn) {
      autoBtn.style.backgroundColor = "crimson";
      autoBtn.style.color = "white";
      autoBtn.style.border = "2px solid darkred";
    }

    // 🔒 対局に戻るボタンを無効化
    const returnBtn = document.getElementById("return-button");
    if (returnBtn) {
      returnBtn.disabled = true;
    }

    autoReplayTimer = setInterval(() => {
      if (window.replayIndex >= window.replayMoves.length) {
      //if (replayIndex >= replayMoves.length) {
        stopAutoReplay();
        return;
      }
      //replayMoveAt(replayIndex);
      //replayIndex++;
      replayMoveAt(window.replayIndex);
      window.replayIndex++;

      updateReplayStatus();
    }, 800);
  }

  function stopAutoReplay() {
    clearInterval(autoReplayTimer);
    autoReplayTimer = null;

    // 🔓 対局に戻るボタンを有効化
    const returnBtn = document.getElementById("return-button");
    if (returnBtn) {
      returnBtn.disabled = false;
    }

    // 🔁 「▶ 自動再生」ボタンのスタイルを元に戻す
    const autoBtn = document.querySelector("button[onclick='startAutoReplay()']");
    if (autoBtn) {
      autoBtn.style.backgroundColor = "";  // デフォルトに戻す
      autoBtn.style.color = "";            // デフォルト（黒）
      autoBtn.style.border = "";           // デフォルト（通常枠）
    }
  }

  function drawInitialBoard() {
    fetch("/initial_board")  // ← 修正ポイント
      .then(res => res.json())
      .then(data => {
        drawBoardFromState(data.board, data.captured);
      });
  }

  function replayUntil(index) {
    // 初期化
    captured_by_player = [];
    captured_by_ai = [];
    updateCapturedPieces({ player: [], ai: [] });

    // 初期盤面を描画（非同期）
    fetch("/initial_board")
      .then(res => res.json())
      .then(data => {
        drawBoardFromState(data.board, data.captured);

        captured_by_player = data.captured?.player ?? [];
        captured_by_ai = data.captured?.ai ?? [];

        updateCapturedPieces({
          player: captured_by_player,
          ai: captured_by_ai
        });

        // indexまで順に再現
        for (let i = 0; i <= index; i++) {
          replayMoveAt(i);
        }

        replayIndex = index + 1;  // 次の手の準備
      });
  }

  function sfenToIndex(pos) {
    const file = parseInt(pos[0], 10);  // 1-9
    const rank = "abcdefghi".indexOf(pos[1]);  // a-i → 0-8
    return rank * 9 + (9 - file);
  }

  function replayMoveAt(index) {
    const moveStr = (window.replayMoves || [])[index];
    const move = moveStr;

    console.log("😂 move=", move, "😂 moveStr=", moveStr);
    if (!move) return;

    let fromStr, toStr, promote = false, isDrop = false, dropPiece = "";

    clearHighlights();
    const { from, to } = parseMoveString(moveStr); // from/to は 0..80 の index
    console.log("from=",from,"to=",to);
    highlightMove2(from, to);

    if (move.includes("*")) {
      isDrop = true;
      const parts = move.split("*");
      dropPiece = parts[0]; // "P"
      toStr = parts[1];     // "2c"
    } else {
      fromStr = move.slice(0, 2);
      toStr = move.slice(2, 4);
      promote = move[4] === "+";
    }

    //const toIndex = sfenToIndex(toStr);
    const toIndex = sfenToIndex(toStr);
    const toCell = document.querySelector(`[data-index="${toIndex}"]`);
    if (!toCell) return;

    // 例: "P*8h"（駒の打ち込み）
    if (isDrop) {
      const toRow = Math.floor(toIndex / 9);
      const toCol = toIndex % 9;
      const toCell2 = document.querySelector(`.cell[data-row='${toRow}'][data-col='${toCol}']`);

      const isPlayerTurn = isPlayerTurnAt(index);
      const isAI = !isPlayerTurn;              // その手を指したのがAI側なら true

      const wrapper = createPiece(dropPiece, isAI);
      toCell2.appendChild(wrapper);
      highlightMove2(null, toIndex);           // ← index を渡す

      // 駒台から1枚減らす（漢字に変換してから）
      const targetChar = toKanji(dropPiece);
      const bag = isPlayerTurn ? captured_by_player : captured_by_ai;
      const idxBag = bag.indexOf(targetChar);
      if (idxBag !== -1) bag.splice(idxBag, 1);
 
      updateCapturedPieces({
        player: captured_by_player,
        ai: captured_by_ai
      });
      //clearHighlights();
      // 🔁 replayIndex は nextMove 側で増やす設計に統一（ここでは触らない）
      return;
    }

    // 🔻 通常の移動処理
    const fromIndex = sfenToIndex(fromStr);
    const fromCell = document.querySelector(`[data-index="${fromIndex}"]`);
    if (!fromCell) return;

    const wrapper = fromCell.querySelector(".piece-wrapper");
    if (!wrapper) return;

    const inner = wrapper.querySelector(".piece");

    // 捕獲処理
    const captured = toCell.querySelector(".piece-wrapper");
    if (captured) {
      const capturedInner = captured.querySelector(".piece");
      const capturedChar = capturedInner.innerText;

      // 表示文字 → USIコードに逆変換 → 成りを外す
      const usiCode = toUsi(capturedChar) || capturedChar;
      const unpromoted = unpromotePiece(usiCode);

      const isAI = captured.classList.contains("ai-piece");

      // 駒台に追加
      if (isAI) {
        //captured_by_player.push(usiToKanji[unpromoted] || unpromoted);
        captured_by_player.push(toKanji(unpromoted));
      } else {
        //captured_by_ai.push(usiToKanji[unpromoted] || unpromoted);
        captured_by_ai.push(toKanji(unpromoted));
      }
    }

    // 成り処理
    if (promote && inner.innerText.length === 1) {
      const promoteMap = {
        "歩": "と",
        "香": "杏",
        "桂": "圭",
        "銀": "全",
        "角": "馬",
        "飛": "竜"
      };
      inner.innerText = promoteMap[inner.innerText] || inner.innerText;
      inner.classList.add("promoted");
    }

    // fromCellの駒（piece-wrapper）のみ削除
    const oldWrapper = fromCell.querySelector(".piece-wrapper");
    if (oldWrapper) fromCell.removeChild(oldWrapper);

    // toCellの駒も削除（index表示は残す）
    const toWrapper = toCell.querySelector(".piece-wrapper");
    if (toWrapper) toCell.removeChild(toWrapper);

    // 駒を移動
    toCell.appendChild(wrapper);

    updateCapturedPieces({
      player: captured_by_player,
      ai: captured_by_ai
    });
      //clearHighlights();
  }

  function isPlayerTurnAt(index) {
    if (!kifu || !kifu.first) {
      console.warn("kifu 未定義");
      return false;
      }
    return (kifu.first === "player") ? (index % 2 === 0) : (index % 2 === 1);
  }

  function enterReplayMode() {
    replayMode = true;

    // セルの背景色を白に変える
    document.querySelectorAll(".cell").forEach(cell => {
      cell.style.backgroundColor = "#fff";
    });

    // 任意：UIメッセージ表示やボタン状態変更
    document.getElementById("replay-message").innerText = "棋譜再生モードに入りました。";
    //refreshKifuList();
  }

  function showReplayUI() {
    gameMode = "replay";
    const panel = document.getElementById("right-panel");
    panel.innerHTML = `
      <h3>棋譜再生</h3>

      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <label>種別
          <select id="kifu-kind">
            <option value="ai">AI対局</option>
            <option value="pvp">人対人（PVP）</option>
            <option value="all">両方</option>
          </select>
        </label>

        <select id="kifu-select" style="min-width:280px;"></select>
        <button id="kifu-load-btn">読み込み</button>
      </div>

      <div style="margin-top: 10px;">
        <button id="btn-replay-start">⏮ 最初</button>
        <button id="btn-replay-prev">◀ 一手戻る</button>
        <button id="btn-replay-next">一手進む ▶</button>
        <button id="btn-replay-auto">▶ 自動再生</button>
        <button id="btn-replay-stop">⏹ 停止</button>
      </div>

      <p id="replay-message"></p>
      <p id="replay-status"></p>
      <hr>
      <button id="return-button">メインメニューに戻る</button>
    `;

    // 種別/読み込み
    document.getElementById("kifu-kind")?.addEventListener("change", refreshKifuList);
    document.getElementById("kifu-load-btn")?.addEventListener("click", loadKifu);

    // ✅ 再生操作ボタンは addEventListener で紐づけ
    document.getElementById("btn-replay-start")?.addEventListener("click", () => goToStart());
    document.getElementById("btn-replay-prev") ?.addEventListener("click", () => preMove());
    document.getElementById("btn-replay-next") ?.addEventListener("click", () => nextMove());
    document.getElementById("btn-replay-auto") ?.addEventListener("click", () => startAutoReplay());
    document.getElementById("btn-replay-stop") ?.addEventListener("click", () => stopAutoReplay());
    document.getElementById("return-button")   ?.addEventListener("click", () => showInitialMenu());

    // 初回リスト
    refreshKifuList();

    // 表示
    replayMode = true;
    const msg = document.getElementById("replay-message");
    if (msg) msg.innerText = "棋譜再生モードに入りました。";
  }

  // 読み込んだ棋譜データ payload を元に再生モードを初期化する共通関数
  function startReplayWithLoadedData(payload) {
    // 盤面・駒台・変数の初期化（明示的に window に置く）
    drawEmptyBoard?.();
    updateCapturedPieces?.({ player: [], ai: [] });

    window.replayMoves = [];
    window.replayIndex = 0;
    window.captured_by_player = [];
    window.captured_by_ai = [];
    window.gameStarted = false;

    // moves を正規化（pvp: payload.moves / 旧ai: payload.kifu[].usi）
    const moves =
      (Array.isArray(payload.moves) && payload.moves.length)
        ? payload.moves
        : (Array.isArray(payload.kifu)
            ? payload.kifu.map(m => m?.usi).filter(Boolean)
            : []);

    // 🟩 ② 抽出した moves の中身を確認
    console.log("🟩 normalized moves length:", moves.length);
    if (moves.length > 0) {
      console.log("🟩 first move:", moves[0]);
    } else {
      console.warn("⚠️ moves が空です。payload に moves/kifu が存在しない可能性があります。");
    }

    window.replayMoves = moves;
    window.replayIndex = 0;

    // 初期局面を描画
    drawInitialBoard?.();

    // 表示メッセージ（保存形式の差を吸収）
    const msg = document.getElementById("replay-message");
    const moveCount = moves.length;

    // 先手表示（player/YOU/main を YOU、ai/AI/sub を AI）
    let firstText = "不明";
    if (payload.first === "player" || payload.first === "YOU" || payload.first === "main") firstText = "YOU";
    else if (payload.first === "ai" || payload.first === "AI" || payload.first === "sub") firstText = "AI";

    let resultText = "";
    if (payload.result === "win")  resultText = "YOUの勝ち";
    if (payload.result === "lose") resultText = "AIの勝ち";
    if (payload.result === "draw") resultText = "引き分け";
    let reasonText = "";
    if (payload.reason === "checkmate") reasonText = "（詰み）";
    if (payload.reason === "resign")    reasonText = "（投了）";

    const shownName = payload.path || payload.filename || "";
    const playerLabel =
      (typeof playerID !== "undefined" && playerID) ? playerID :
      (Array.isArray(payload.players) ? (payload.players[0] || "不明") : (payload.player_id || "不明"));

    if (msg) {
      msg.innerHTML =
        `棋譜「${shownName}」を読み込みました（${moveCount}手）。<br>` +
        `ID：${playerLabel}　先手：${firstText}` +
        (resultText ? `　勝敗：${resultText}${reasonText}` : "");
    }
    // 🟩 ③ 最終確認：window変数に格納されているか
    console.log("window.replayMoves =", window.replayMoves);
    console.log("window.replayIndex =", window.replayIndex);
  }

  function showInitialMenu() {
    console.log("playerID=",playerID);
    const panel = document.getElementById("right-panel");
    const disabledAttr = playerID ? "" : "disabled";

    panel.innerHTML = `
      <h3>入室設定</h3>
      <input type="text" id="login-id-input" placeholder="IDを入力" value="${playerID || ''}" /><br>
      <button onclick="login()">ログイン</button>
      <button onclick="logout()">ログアウト</button>
      <p id="login-message" style="color:red;"></p>

      <h3>メインメニュー</h3>
      <button onclick="showAsMain()" ${disabledAttr}>対人対局メイン</button><br>
      <button onclick="showAsSub()" ${disabledAttr}>対人対局サブ</button><br>
      <button onclick="showHumanVsAI()" ${disabledAttr}>AIとの対局</button><br>
      <button onclick="alert('AI同士の対局は未実装')" ${disabledAttr}>AI同士の対局</button><br>
      <button onclick="showReplayUI()" ${disabledAttr}>棋譜再生</button><br><br>

      <!-- 管理者専用: 初期は非表示にしておく -->
      <button id="btn-train" style="display:none" onclick="location.href='/train'">AIの学習</button>
    `;
    // ここで表示可否を切り替える（playerIDが確定している前提）
    const allowed = new Set(["shogi_master"]); // クライアント側のヒント。権限チェックはサーバでも必ず実施
    const btn = document.getElementById('btn-train');
    if (btn) {
      if (playerID && allowed.has(playerID)) {
        btn.style.display = 'inline-block';
      } else {
        btn.style.display = 'none';
      }
    }
    drawEmptyBoard();
    updateCapturedPieces({player:[],ai:[]});
  }

  function login() {
    const id = document.getElementById("login-id-input").value.trim();
    if (!id) {
      document.getElementById("login-message").textContent = "IDを入力してください";
      return;
    }

    fetch("/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ id })
    })
    .then(res => {
      if (!res.ok) throw new Error("すでに同じIDがログイン中です");
      return res.json();
    })
    .then(() => {
      playerID = id;
      loginFlag = true;
      showInitialMenu(); // ← 再描画でメニューを有効化！
      // ログイン成功時にこのように書く
      document.getElementById("login-id-display").innerText = `👤 ID: ${playerID}`;
      localStorage.setItem("userId", id);  // ★追加：復元の手がかり
    })
    .catch(err => {
      document.getElementById("login-message").textContent = err.message;
    });
  }

  function logout() {
    if (!playerID) return;

    localStorage.removeItem("userId");

    fetch("/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: playerID })
    })
    .then(() => {
      playerID = "";
      loginFlag = false;
      showInitialMenu();
      document.getElementById("login-id-display").innerText = `👤 ID: 退室中`;
    });
  }

  function showAsMain() {
    gameMode = "main"
    const panel = document.getElementById("right-panel");

    function fetchAndUpdate() {
      fetch(`/waiting_sub_ids?exclude=${encodeURIComponent(playerID)}`)
        .then(res => res.json())
        .then(waitingList => {

          console.log("🔁 polling...", waitingList);

          const currentSelections = {};
          waitingList.forEach(id => {
            const selected = document.querySelector(`input[name="first-${id}"]:checked`);
            if (selected) {
              currentSelections[id] = selected.value;
            }
          });

          if (waitingList.length === 0) {
            panel.innerHTML = `
              <p>待機中のプレイヤーはいません。</p>
              <button onclick="stopPollingAndReturn()">戻る</button>
            `;
            return;
          }

          let buttons = waitingList.map(id => {
            const selected = currentSelections[id] || "me";
            return `
              <div style="margin-bottom: 8px;">
                <label>${id}</label><br>
                <label><input type="radio" name="first-${id}" value="me" ${selected === "me" ? "checked" : ""}> 自分が先手</label>
                <label><input type="radio" name="first-${id}" value="opponent" ${selected === "opponent" ? "checked" : ""}> 相手が先手</label><br>
                <button onclick="sendMatchRequest('${id}')">リクエスト送信</button>
              </div>
            `;
          }).join("");

          panel.innerHTML = `
            <h3>対局相手と先手を選択</h3>
            ${buttons}
            <br><button onclick="stopPollingAndReturn()">戻る</button>
          `;
        });
    }

    fetchAndUpdate();
    pollingTimer = setInterval(fetchAndUpdate, 3000);
  }

  function stopPollingAndReturn() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
    showInitialMenu();  // メインメニューに戻す処理
  }

  async function sendMatchRequest(toId) {
    const radio = document.querySelector(`input[name="first-${toId}"]:checked`);
    const first = radio.value === "me" ? "main" : "sub";

    try {
      const response = await fetch("/send_request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: playerID,
          to: toId,
          first: first
        })
      });

      const result = await response.json();
      if (result.success) {
        alert("リクエストを送信しました。サブIDの応答を待ってください。");

        // ✅ 成功後にポーリング開始
        pollForMatchAcceptance(toId);
      } else {
        alert("リクエスト送信に失敗しました: " + result.message);
      }
    } catch (error) {
      console.error("リクエスト送信エラー:", error);
      alert("通信エラーが発生しました");
    }
  }
   
  function pollForMatchAcceptance(toId) {
    console.log("🔴メインのサブからのOK待ち");

    const intervalId = setInterval(() => {
      fetch(`/check_match_status?main_id=${playerID}&sub_id=${toId}`)
        .then(res => res.json())
        .then(data => {
          console.log("🟠data,status=", data.status);
          console.log("🟠 data =", data);


          if (data.status === "accepted") {
            const first = data.first;  // ✅ 必ず取得してから使う
            clearInterval(intervalId);

            // ✅ 対局画面へ遷移（firstを含む）
            window.location.href = `/match_board?role=main&main_id=${playerID}&sub_id=${toId}&first=${first}&player_id=${playerID}`;

          }
        })
        .catch(err => {
          console.error("❌ エラー:", err);
        });
    }, 3000);
  }

  function showAsSub() {
    gameMode = "sub"
    fetch("/wait_as_sub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: playerID })
    });

    const panel = document.getElementById("right-panel");
    panel.innerHTML = `
      <h3>サブIDとして待機中...</h3>
      <p>メインIDからの対局リクエストを待っています。</p>
      <div id="match-request-area"></div>
      <button onclick="cancelSubWait()">待機キャンセル</button>
      <button id="return-button" onclick="showInitialMenu()">メインメニューに戻る</button>
    `;

    // 対局リクエストを定期的に確認
    startPollingForMatchRequest();
  }

  function cancelSubWait() {
    fetch("/cancel_sub_wait", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: playerID })
    }).then(() => {
      console.log("🛑 サブの待機をキャンセルしました");
      showInitialMenu();
    }).catch(err => {
      console.error("待機キャンセル失敗:", err);
    });
  }

  function startPollingForMatchRequest() {
    console.log("📡 サブのメインからのリクエスト待ち");

    setInterval(() => {
      fetch(`/check_match_request?id=${playerID}`)
        .then(response => response.json())
        .then(data => {
          console.log("🔁 polling... ", data);

          if (data.requested) {
            console.log("✅ 対局リクエストあり");

            const fromId = data.from;
            const first = data.first;

            showRequestConfirmation(fromId, first);  // OKボタン表示処理など
          } else {
            console.log("⏳ リクエストなし");
          }
        })
        .catch(error => {
          console.error("❌ ポーリングエラー:", error);
        });
    }, 3000);  // 3秒ごとにチェック
  }

  function showRequestConfirmation(fromId, first) {
    const area = document.getElementById("match-request-area");
    area.innerHTML = `
      <p>メインID <strong>${fromId}</strong> から対局リクエストがあります。</p>
      <p>先手：${first === "main" ? fromId : playerID}</p>
      <button onclick="acceptMatch('${fromId}', '${first}')">OK</button>
      <button onclick="declineMatch()">キャンセル</button>
    `;
  }

  function acceptMatch(fromId, first) {
    console.log("🔴 acceptMatch");
    fetch("/accept_match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        main: fromId,       // メインID
        sub: playerID,      // 自分（サブID）
        first: first
      })
    }).then(() => {
      // ✅ 対局画面に遷移（役割やID情報を明示）
      window.location.href = `/match_board?role=sub&main_id=${fromId}&sub_id=${playerID}&first=${first}&player_id=${playerID}`;
    });
  }

  function declineMatch() {
    document.getElementById("match-request-area").innerHTML = "<p>リクエストを拒否しました。</p>";
    startPollingForMatchRequest(); // 再度待機に戻る
  }

  function showMessage(text) {
    const area = document.getElementById("message-area");
    if (area) {
      area.innerHTML = text;
    }
  }

  initPage();

  async function initPage() {
    // 直前に使ったIDを補助的に保持（権威ではない）
    const last = localStorage.getItem("userId");

    // そのIDがサーバー側で「まだログイン中」なら復元する
    if (last && await isLoggedInOnServer(last)) {
      playerID = last;
      loginFlag = true;
      showInitialMenu(); // ← ログイン時メニューを表示
      document.getElementById("login-id-display").innerText = `👤 ID: ${playerID}`;
      return;
    }

    // 未ログイン扱いで初期表示
    loginFlag = false;
    showInitialMenu();
    drawEmptyBoard();
    document.getElementById("login-id-display").innerText = `👤 ID: 退室中`;
  }

  async function isLoggedInOnServer(id) {
    try {
      const res = await fetch(`/is_logged_in?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      return !!data.logged_in;
    } catch {
      return false;
    }
  }

  // ----- 共通ユーティリティ -----
  function setReplayMsg(text) {
    const el = document.getElementById("replay-message") || document.getElementById("message-box");
    if (el) el.innerText = text;
  }

  function updateReplayStatus() {
    const el = document.getElementById("replay-status");
    if (!el) return;
    const total = (window.replayMoves || []).length;
    const idx   = window.replayIndex ?? 0;   // “次に再生する手”のインデックス
    el.innerText = `再生：${idx} / ${total}手`;
  }

  // ----- 最初に戻る -----
  function goToStart() {
    console.log("⏮ goToStart: 棋譜の最初に戻ります");

    if (typeof drawInitialBoard === "function") {
      drawInitialBoard();
    } else if (typeof drawBoardFromState === "function") {
      drawBoardFromState(initialBoardState);
    }

    window.replayIndex = 0;
    if (window._autoTimer) {
      clearInterval(window._autoTimer);
      window._autoTimer = null;
    }

    updateReplayStatus();
    setReplayMsg("⏮ 最初の手に戻りました。");
  }

  // ----- 一手戻る -----
  function preMove() {
    const idx = window.replayIndex ?? 0;
    const arr = window.replayMoves || [];
    if (idx > 0) {
      // あなたの既存ヘルパーを活かす版：
      // 「次に再生する手 idx を、idx-1 にする」= 盤面は 0..(idx-2) を適用した状態
      if (typeof replayUntil === "function") {
        replayUntil(idx - 2); // 0-based で inclusive を想定（あなたの実装ルールに合わせてOK）
        window.replayIndex = idx - 1;
      } else {
        // ヘルパーが無い場合の素朴巻き戻し
        if (typeof drawInitialBoard === "function") drawInitialBoard();
        for (let i = 0; i < idx - 1; i++) {
          replayMoveAt(i);
        }
        window.replayIndex = idx - 1;
      }
      updateReplayStatus();
      setReplayMsg("◀ 1手戻りました。");
    } else {
      setReplayMsg("⏮ すでに最初の手です。");
    }
  }

  // ----- 一手進む -----
  function nextMove() {
    const arr = window.replayMoves || [];
    const idx = window.replayIndex ?? 0;
    console.log("⭕️ nextMove", { idx, total: arr.length });

    if (idx < arr.length) {
      // あなたの既存ヘルパーを活かす
      replayMoveAt(idx);
      window.replayIndex = idx + 1;
      updateReplayStatus();
    } else {
      setReplayMsg("▶ 最後の手まで再生しました。");
    }
  }

  window.login = login;
  window.logout = logout;
  window.showInitialMenu = showInitialMenu;
  window.showAsMain = showAsMain;
  window.showAsSub = showAsSub;
  window.showReplayUI = showReplayUI;
  window.showHumanVsAI = showHumanVsAI;
  window.startGame = startGame;
  window.resetBoard = resetBoard;
  window.resignGame = resignGame;
  window.saveKifu = saveKifu;
  window.loadKifu = loadKifu;
  window.goToStart = goToStart;
  window.preMove = preMove;
  window.nextMove = nextMove;
  window.startAutoReplay = startAutoReplay;
  window.stopAutoReplay = stopAutoReplay;
  window.replayMoves  = window.replayMoves  || [];
  window.replayIndex  = window.replayIndex  || 0;
  window._autoTimer   = window._autoTimer   || null;
  window.stopPollingAndReturn = stopPollingAndReturn;
  window.sendMatchRequest = sendMatchRequest;
  window.cancelSubWait = cancelSubWait;
  window.declineMatch = declineMatch;
  window.acceptMatch = acceptMatch;
  window.handleCellClick = handleCellClick;
  //window.pollMatchAccepted = pollMatchAccepted;
  window.gameMode = "main";  // ログイン後や対局開始時に動的に設定する

});
