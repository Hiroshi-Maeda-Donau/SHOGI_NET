# SHOGI_NET – Operation Guide (English Version)

This document explains how to use SHOGI_NET,  
including menu navigation, buttons, and game controls.

---

# 1. Main Menu

From the main menu, you can access:

- **Human vs Human (PVP)**
- **Human vs AI**
- **Kifu Replay**
- **AI Training**  

👉 [AI vs AI] is not yet coded.

---

# 2. Login ID (Common Requirement)

Before starting any game (PVP or AI),  
you must **register a Login ID**.

- ID can be any string  
- Duplicate login using the same ID is not allowed  
- Button color changes on successful login

![log in](static/img/login_screen_ja.png)  

After logging in, all main menu buttons become available.

---

# 3. Human vs Human (PVP)

## 3-1. Choosing Main / Sub

When selecting PVP_MAIN or PVP_SUB, the following screen appears:

### ● Main
- Initiates the match  
- Displays a list of waiting Sub IDs  
- Selects an opponent and sends a request  

### ● Sub
- Waits for a request from Main  
- Approves the request to start the match

---

## 3-2. Matching Flow

(Example: from the Main side)

1. Choose “pvp Main”    
2. A list of waiting Sub IDs is displayed  
3. Select a Sub ID and press “Request”  
4. If Sub presses “OK”, the match becomes ready to starts  
5. Both screens transit to "pvp ready" screen  
6. Clicking [StartGame] button leads the following screen

![pvp main](static/img/pvp_main_start_ja.png)  

---

## 3-3. Board Screen Overview

- Your own pieces → **bottom, upright orientation**  
- Opponent pieces → **top, rotated upside-down**  
- Piece stand (komadai) always adapts to the user  
- Board is synchronized via **periodic polling**

---

## 3-4. How to Move Pieces

1. **Click the piece you want to move**  
2. **Click the destination square**

If promotion is available:  
→ A small dialog appears (Promote / Do not promote)

---

## 3-5. Dropping Pieces from Komadai

1. Click a piece in your komadai  
2. Click the target square on the board

---

## 3-6. Turn Notification

- Your turn: **“Your move”**  
- Opponent’s turn: **“Opponent is thinking…”**

---

## 3-7. Reset (Return to Initial Position)

### ● Main side
- Press the **Reset Request** button  
- The request is sent to the Sub side

### ● Sub side
- A blinking approval button appears  
- When approved, the board resets to the initial state  
- Comments are also synchronized via the server

---

# 4. Human vs AI

![human vs ai](static/img/human_vs_ai_ja.png)  

Available options:

- Choose **First** or **Second**  
- AI engines:
  - simple AI  
  - minimax AI  
  - learning AI  

AI thinking is executed on the server side  
and results are immediately reflected on the board.

---

# 5. Kifu Replay

![kifu replay](static/img/replay_kifu_ja.png)  

After selecting a kifu file, the replay screen appears.

### Available Controls

- **Go to Start**  
- **Step Back**  
- **Step Forward**  
- **Auto Play** (button turns red during playback)  
- **Stop**  
- **Return to Game**

The board advances through:

Initial position → Move 1 → Move 2 → …

---

# 6. AI Training

![AI training](static/img/training_ja.png) 

The AI training menu contains:

### ● Incremental Training
- Trains only new kifus  
- Uses `seen_games.json` to track processed records

### ● Full Training
- Rebuilds from **all** kifus  
- Clears fingerprints → AI returns to “fresh” state

### ● Flip Processing
- Converts `pvp` data → `pvp_flip`  
- Balances first/second move data

### ● Model Saving
Models are saved under:

models/
shogi_policy.keras
shogi_policy_best.keras
*.h5  

👉 [Refresh] button is not yet coded.

---

# 7. Directory Roles (Relevant to Operations)

kifu/
ai/ AI match records
pvp/ human vs human kifu
pvp_flip/ flipped (sente/gote swapped) kifu
registry/ registries (seen_games.json)
models/ trained models
snapshots/ temporary data (future use)
static/js/ front-end Shogi logic
templates/ HTML UI

---

# 8. Frequently Asked Questions (FAQ)

### Q. A piece won’t move  
→ Check if it is your turn.

### Q. Board does not synchronize  
→ Polling may have stopped  
→ Reload (F5)

### Q. AI does not move  
→ Check server console for errors

### Q. Kifu is not saved  
→ Verify folders under `kifu/`  
→ `.gitkeep` files should remain in empty folders

---

# 9. Future Updates (Operation Guide)

- Enhanced UI    
- Bilingualization  
- install AI vs AI

---

This completes the SHOGI_NET operation guide (English version).  
The structure matches the Japanese version exactly, and image placeholders are ready for later insertion.

