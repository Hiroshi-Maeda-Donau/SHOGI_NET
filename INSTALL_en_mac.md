# SHOGI_NET – Installation Guide for macOS (English)

This document describes how to install and run **SHOGI_NET** on macOS.  
The server runs on Python + Flask, and clients access the server via Chrome.

---

# 1. System Requirements

### Hardware
- MacBook / iMac / Mac mini (Intel or Apple Silicon)

### Software
- macOS 12+ recommended
- Python 3.10.x (recommended)
- Google Chrome (latest version)
- Git (Homebrew or official installer)

---

# 2. Install Python (if not installed)

macOS often includes an outdated Python.  
Install a modern version using Homebrew or python.org.

### Option A: Install via Homebrew (recommended)  
```bash
brew install python@3.10
```
### Option B: Install from python.org  
```
Download from:
https://www.python.org/downloads/macos/

👉 Make sure to check:  
✔ “Add python to PATH” (if available)

Verify:

```bash
python3 --version  
```

# 3. Clone the SHOGI_NET repository
Move to any folder (e.g., Desktop):

```bash
cd ~/Desktop
git clone https://github.com/Hiroshi-Maeda-Donau/SHOGI_NET.git
cd SHOGI_NET  
```
# 4. Create a virtual environment(venv310)
```bash
python3 -m venv venv310
```
Activate the environment:
```bash
source venv310/bin/activate  
```
Terminal should show:
text```
(venv310) yourname@Mac ...  
```
Deactivate anytime:
```bash  
deactivate
```
# 5. Install required Python packages
```bash
cd SHOGI_NET
pip install -r requirements.txt
```
👉 This installs:

- Flask

- python-shogi

- numpy

- model loaders (keras/tensorflow if included)

- other dependencies

# 6. Start the Flask server
In the SHOGI_NET folder:

```bash
python shogi_main.py  
```
If successful, you should see:

```csharp
 * Running on http://127.0.0.1:5000  
```

# 7. Access the game in your browser  
Open Google Chrome and go to:
```arduino
http://localhost:5000
```
You should now see:

- Main menu

  - PVP / AI match options

  - Kifu replay mode

  - others

# 8. LAN Play (Human vs Human across multiple PCs)
To allow another PC (Windows or Mac) to connect:

Check Mac’s local IP address:

```bash
ifconfig | grep inet  
```
Typical IP example:
```bash
192.168.0.14  
```
From another PC's Chrome:
```
http://192.168.0.14:5000
```
Now both players can:

- Register Main/Sub ID

- Match

- Start a PVP game

---

# 9. Kifu & AI Model folders
The following folders must exist (included in repository):
```
kifu/
  ai/
  pvp/
  pvp_flip/
  registry/
models/
snapshots/
```
macOS uses case-sensitive paths inside scripts.
Do not rename or move these folders.

# 10. Updating the Project
If the repository updates:
```bash
git pull
```
If dependencies change:

```bash
pip install -r requirements.txt  
```
# 11. Troubleshooting
❗ Flask does not start
→ Virtual environment not activated

```bash
source venv/bin/activate  
```
❗ When Chrome cannot connect from another PC
→ Mac firewall may be blocking


Go to:  
- System Preferences → Security → Firewall → Options  
- Allow Python / Flask.

❗ When Port 5000 already in use
Find the process:

```bash
lsof -i :5000
```
Kill it:

```bash
kill -9 <PID>  
```
# 12. Uninstallation
The environment is fully contained in the SHOGI_NET folder.
Just delete it:

```bash
rm -rf ~/Desktop/SHOGI_NET  
```
✔ You are now ready to run SHOGI_NET on macOS!
Enjoy Human-vs-Human (LAN) and AI matches in your browser.

---

