import asyncio
import websockets

async def test_ws():
    uri = "ws://127.0.0.1:8000/ws/clients"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri) as websocket:
            print("✅ Connected!")
            msg = await websocket.recv()
            print(f"Received: {msg[:100]}...")
    except Exception as e:
        print(f"❌ Connection failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_ws())
