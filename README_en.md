
# SHOGI_NET (English Version)

SHOGI_NET is a browser-based Shogi (Japanese chess) game.  
It supports Human-vs-Human matches over a local network (LAN),  
Human-vs-AI matches, game record (kifu) saving, and replay features.  

A Flask server runs on a host PC (macOS or Windows),  
and client PCs access it via Google Chrome.

---

## Features

### 🧑‍🤝‍🧑 **Human vs Human (PVP)**  
- Matching system using **Main ID / Sub ID**  
- Playable from multiple PCs on the same LAN  
- Your own pieces always appear at the bottom; opponent pieces are rotated and displayed at the top  
- Server-side `match_states` holds the entire match state  
- Clients poll the server regularly to keep boards synchronized  
- Reset request system:
  - Main side: sends reset request  
  - Sub side: accepts and game resets

---

### 🤖 **Human vs AI (PVA)**  
- Player can choose to play **first** or **second**  
- Supports multiple AI engines such as Simple AI, Minimax AI, and Learning AI  
- AI moves are calculated server-side and sent immediately to the client

---

### 📜 **Kifu Saving & Replay**
- All matches (PVP / AI) are saved automatically in JSON format  
- Saved to the following directories:  

  - kifu/pvp/ … Human vs Human records
  - kifu/ai/ … Human vs AI records
  - kifu/pvp_flip/ … Flipped records (Sente/Gote reversed)
  - kifu/registry/ … Registries such as seen_games.json


- Replay mode supports:  

  - Go to beginning

  - Step backward

  - Step forward

  - Auto play

  - Stop

  - Return to game

---

### 💾 **AI Models & Training Data**
- `models/` … AI model files (.h5 / .keras)  
- `snapshots/` … Game snapshots (pause/resume support)  
- `learn/` … Flip processing, data shaping tools, and training scripts  
- AI training system is currently under development and being improved

---

### 🌐 **Local Network Operation**
- Start the Flask server on macOS or Windows  
- Other PCs on the LAN connect via:  
```bash  
    http://<server-ip>:5000
```
- Designed for home LAN play, office use, and small local networks

---

## System Overview

### 📌 Server (Python / Flask)
- Python 3.10 recommended  
- Flask-based REST/JSON API  
- Responsibilities:
- Store match states  
- Return board updates for polling  
- AI move calculation  
- Save kifus and training data  
- Manage Main/Sub ID matching  
- Registry management (`match_states`, `game_states`)

---

### 📌 Client (HTML / JavaScript)
- Google Chrome recommended  
- UI implemented using HTML/CSS/JavaScript  
- Click → Move system for piece control  
- JavaScript handles animations and board synchronization  
- Works on Windows or macOS clients over a browser

---

## Directory Structure (Overview)

```text
SHOGI_NET/
├ README_en.md          # This file
├ README_ja.md          # Japanese version
├ INSTALL_en_mac.md     # Installation guide for macOS (English)
├ INSTALL_ja_mac.md     # Installation guide for macOS (Japanese)
├ INSTALL_en_win.md     # Installation guide for Windows (English)
├ INSTALL_ja_win.md     # Installation guide for Windows (Japanese)
├ requirements.txt      # Python dependencies
├ shogi_main.py         # Flask server entry point
├ static/
│   └ js/               # Shogi logic / UI control JS
├ templates/            # HTML templates
├ kifu/
│   ├ ai/
│   ├ pvp/
│   ├ pvp_flip/
│   └ registry/         # Kifu registries (seen_games.json etc.)
├ models/               # AI models (.h5 / .keras)
├ snapshots/            # Game snapshots (pause/resume)
├ learn/                # Training tools and scripts
├ utils/                # Utility scripts
└ .gitignore            # Git ignore settings  
```

## System Requirements

**Server OS**

- macOS

- Windows 11

**Client**  

- Google Chrome

- Python(Python 3.10 recommended : 3.x compatible)

**Quick Start (Summary)**

For full details, see the installation documents (INSTALL_en_mac.md, INSTALL_en_win.md).

**Clone the repojitory**  
```bash  
git clone https://github.com/Hiroshi-Maeda-Donau/SHOGI_NET.git
cd SHOGI_NET
```

**Create virtual environment**
```bash
python -m venv venv
source venv/bin/activate        # Windows: .\venv\Scripts\activate  
```

**Install dependencies**  
```bash
pip install -r requirements.txt
```
**Start Flask server**
```bash
python shogi_main.py
```

**Access via browser**
```arduino
http://localhost:5000
```

## ⭕️ About Kifu Data (Copyright)

### Saved kifu files are:
```
- Matches you played yourself  
- Publicly known games manually re-entered on your own  
- Kifu (moves) are factual records and not protected by copyright
- No diagrams, comments, or proprietary content are copied
- No copying from paid apps or books is performed
```
## Roadmap  
```
- Stabilize PVP functionality    
- Enhance AI (introduce learning AI)  
- UI and UX improvements  
- Expanded kifu management  
- Additional languages (German version…?)  
```
## Author
```
Developer: Hiroshi Maeda    
Environment: macOS / Python / Flask / JavaScript    
Personal project for research and hobby development    
```

