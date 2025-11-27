# SHOGI_NET – Installation Guide (Windows, English Version)

This document explains how to install and launch **SHOGI_NET** on Windows.  
The server runs on Python + Flask, and clients access it via Google Chrome.

---

# 1. System Requirements

### Hardware
- Windows PC (desktop or laptop)

### Software
- Windows 10 / 11
- Python 3.10 (recommended)
- Google Chrome (latest)
- Git (official installer recommended)

---

# 2. Installing Python (if not installed)

Download Python for Windows from the official website:

```text
https://www.python.org/downloads/windows/
```

Important installation note
On the very first installer screen, you MUST check:

☑ Add python.exe to PATH

If this is not checked, Python will not run from PowerShell.

After installation, verify the version:

```powershell
python --version
```

# 3. Clone the SHOGI_NET Repository
Open the folder where you want to work (e.g., Desktop).
Shift + Right-click → “Open PowerShell window here”

Then run:

```powershell
git clone https://github.com/Hiroshi-Maeda-Donau/SHOGI_NET.git
cd SHOGI_NET
```

# 4. Create the Virtual Environment (venv)
For Windows, the virtual environment name is venv.

```powershell
python -m venv venv
```
Activate the virtual environment:

```powershell
.\venv\Scripts\activate
```

If successful, the prompt changes to:

```text
(venv) C:\Users\YourName\Desktop\SHOGI_NET>
```
To deactivate:

```powershell
deactivate
```

# 5. Install Required Python Packages
With the virtual environment active, install dependencies from requirements.txt:

```powershell
pip install -r requirements.txt
```
This installs:

```
- Flask
- python-shogi
- numpy
- keras / tensorflow (if included)
- Other required dependencies
```

# 6. Launch the Flask Server
Run the server inside the SHOGI_NET folder:

```powershell
python shogi_main.py
```
If successful, you will see:

```text
 * Running on http://127.0.0.1:5000
```

# 7. Access the Game from the Browser
Open Google Chrome and visit:

```text
http://localhost:5000
```
You should see:

```
- Login ID registration
- Human vs Human (PVP): Main / Sub
- Human vs AI
- Kifu replay
- AI training
```

# 8. Using PVP Match over LAN (Multiple PCs)
To allow other PCs (Windows or Mac) on the same LAN to connect:

## 1) Check the server PC’s IP address
Run:

```powershell
ipconfig
```
Example:

```text
IPv4 Address . . . . . . . . . : 192.168.0.23
```

## 2) Access from another PC
On the other PC's Chrome:

```text
http://192.168.0.23:5000
```
You can now use:

```
- Main ID / Sub ID registration
- Matching
- Start PVP game
```

# 9. Kifu & AI Model Folders
The repository assumes the following folder structure:

```text
kifu/
  ai/
  pvp/
  pvp_flip/
  registry/
models/
snapshots/
```
Windows is not case-sensitive, but do not rename or move these folders.

# 10. Updating the Project
To fetch the latest version from GitHub:

```powershell
git pull
```
If requirements have changed:

```powershell
pip install -r requirements.txt
```

# 11. Troubleshooting
❗ Flask server does not start
Virtual environment may not be active:

```powershell
.\venv\Scripts\activate
python shogi_main.py
```
❗ Other PCs cannot connect
Possible cause:

- Windows Firewall is blocking the connection

Solution:

- Open Settings

- Privacy & Security → Windows Security

- Firewall & Network Protection

- Allow an app through firewall

- Allow python.exe

❗ Port 5000 is already in use
Check usage:

```powershell
netstat -ano | findstr :5000
```
Terminate the process:

```powershell
taskkill /PID <PID> /F
```

# 12. Uninstallation
All SHOGI_NET data is contained inside its folder.
To uninstall, simply delete the folder.

```powershell
rd /s /q SHOGI_NET
```
Example (on Desktop):

```powershell
rd /s /q C:\Users\YourName\Desktop\SHOGI_NET
```

### 🎉 SHOGI_NET is now ready to use on Windows!
### Enjoy local matches, LAN PVP battles, and AI games.

---


