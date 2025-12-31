# How to Run the Project

This project now consists of a **Python Backend** (for API handling) and a **React Frontend** (for UI). You need to run both terminals.

## 1. Start the Python Backend
This server handles the API credentials and fetches data from Binance and CoinSwitch.

```bash
# In Terminal 1
python3 -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```
*It processes requests at `http://localhost:8000`.*

## 2. Start the Frontend
This runs the React interface.

```bash
# In Terminal 2
npm run dev
```
*Access the app at `http://localhost:5173` (or similar port shown).*

## Troubleshooting
- **Port 8000 in use?**
  Run this to kill the old process:
  ```bash
  lsof -ti:8000 | xargs kill -9
  ```
- **Dependencies missing?**
  ```bash
  pip3 install -r backend/requirements.txt
  npm install
  ```
