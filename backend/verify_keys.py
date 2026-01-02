from pybit.unified_trading import HTTP
import json

# Provided keys
API_KEY = "GS68TldhIYqdRUOz4V"
API_SECRET = "b5suxCOFWQsV2IoGDZ2HnNyhxDvt4NQNAReK"

def check_private_access():
    print("Testing Private API Access (Wallet Balance)...")
    try:
        # Initializing session - User didn't specify Testnet, but 'Demo Trading' usually implies it.
        # However, the keys look like standard keys. Let's try Testnet=True first. 
        # Bybit Testnet keys usually start with 'X' or similar? Not always.
        # Let's try Testnet first. If invalid, try Mainnet.
        
        print("Attempting TESTNET...")
        session_test = HTTP(
            testnet=True,
            api_key=API_KEY,
            api_secret=API_SECRET,
        )
        try:
            balance = session_test.get_wallet_balance(accountType="UNIFIED", coin="USDT")
            print("TESTNET SUCCESS!")
            print(json.dumps(balance, indent=2))
            return ("testnet", True)
        except Exception as e:
            print(f"Testnet Failed: {e}")
            
        print("\nAttempting MAINNET...")
        session_main = HTTP(
            testnet=False,
            api_key=API_KEY,
            api_secret=API_SECRET,
        )
        try:
            balance = session_main.get_wallet_balance(accountType="UNIFIED", coin="USDT")
            print("MAINNET SUCCESS!")
            print(json.dumps(balance, indent=2))
            return ("mainnet", True)
        except Exception as e:
            print(f"Mainnet Failed: {e}")
            
        return (None, False)

    except Exception as e:
        print(f"Critical Error: {e}")
        return (None, False)

if __name__ == "__main__":
    # We need to install pybit first manually or assume it is handled by 'pip install pybit'
    # For now, I will assume I need to install it.
    check_private_access()
