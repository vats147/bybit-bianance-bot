import json
import os

path = "/Users/vats/Desktop/newBOt-1/sessions.json"
if os.path.exists(path):
    with open(path, "r") as f:
        data = json.load(f)
    
    for uid in data:
        if isinstance(data[uid].get("active_trades"), list):
            print(f"Cleaning up user {uid[:8]} active_trades (was list)")
            data[uid]["active_trades"] = {}
            
    with open(path, "w") as f:
        json.dump(data, f)
    print("Cleanup complete.")
