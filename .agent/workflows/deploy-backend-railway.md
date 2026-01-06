---
description: Deploy Python Backend to Railway
---

# Deploy Backend to Railway.app

## Prerequisites
1. Create a free account at [Railway.app](https://railway.app)
2. Install Railway CLI (optional): `npm install -g @railway/cli`

## Step 1: Prepare Backend for Deployment

Your backend is already well-structured with:
- ✅ `backend/main.py` (FastAPI app)
- ✅ `backend/requirements.txt` (dependencies)
- ✅ `backend/.env` (environment variables)
- ✅ `backend/Dockerfile` (containerization)

## Step 2: Deploy via Railway Dashboard (Easiest)

1. Go to [railway.app/new](https://railway.app/new)
2. Click **"Deploy from GitHub repo"**
3. Select your repository: `romit5075/newBOt`
4. Railway will auto-detect Python
5. Configure the following:

   **Root Directory**: `backend`
   
   **Build Command**: `pip install -r requirements.txt`
   
   **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   
   **Environment Variables** (Add these in Railway dashboard):
   ```
   BYBIT_API_KEY=<your-key>
   BYBIT_SECRET=<your-secret>
   USER_BYBIT_KEY=<your-key>
   USER_BYBIT_SECRET=<your-secret>
   USER_BINANCE_KEY=<your-key>
   USER_BINANCE_SECRET=<your-secret>
   BYBIT_DEMO_URL=https://api-testnet.bybit.com
   BINANCE_WS_LIVE=wss://fstream.binance.com/ws/!markPrice@arr
   BINANCE_WS_TESTNET=wss://stream.binancefuture.com/ws/!markPrice@arr
   ```

6. Click **"Deploy"**
7. Railway will provide a URL like: `https://your-app.railway.app`

## Step 3: Update Frontend to Use Railway Backend

After deployment, update your frontend environment:

1. Copy your Railway backend URL
2. Update `src/App.jsx` or create `.env` file with:
   ```
   VITE_BACKEND_URL=https://your-app.railway.app
   ```

## Step 4: Alternative - Deploy via Railway CLI

```bash
# Install CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
cd /Users/vats/Desktop/newBOt-1/backend
railway init

# Link to project
railway link

# Add environment variables
railway variables set BYBIT_API_KEY=your-key
railway variables set BYBIT_SECRET=your-secret
# ... add all other env vars

# Deploy
railway up
```

## Step 5: Verify Deployment

Test your deployed backend:
```bash
curl https://your-app.railway.app/
curl https://your-app.railway.app/api/rates
```

## Alternative: Render.com

If you prefer Render:

1. Go to [render.com](https://render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect GitHub repo
4. Configure:
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add environment variables
6. Deploy

Your backend will be available at: `https://your-service.onrender.com`

