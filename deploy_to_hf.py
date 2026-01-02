import os
import sys
from huggingface_hub import HfApi, login, create_repo
from huggingface_hub.utils import RepositoryNotFoundError, LocalTokenNotFoundError

def deploy():
    print("🚀 Starting Deployment to Hugging Face Spaces...")
    
    # Configuration
    REPO_ID = os.getenv("HF_SPACE_REPO", "vats147/bianance-bot")
    LOCAL_FOLDER = "backend"
    
    if not os.path.exists(LOCAL_FOLDER):
        print(f"❌ Error: Directory '{LOCAL_FOLDER}' not found.")
        return

    # Authentication
    token = os.getenv("HF_TOKEN")
    if not token:
        try:
            # Check if user is already logged in locally
            # This will raise LocalTokenNotFoundError if not logged in
            from huggingface_hub import get_token
            token = get_token()
            if not token:
                 raise LocalTokenNotFoundError
            print("🔑 Found local Hugging Face token.")
        except LocalTokenNotFoundError:
            print("⚠️ HF_TOKEN not found in env and not logged in locally.")
            print("Please enter your Hugging Face User Access Token (with WRITE permissions).")
            print("You can find it here: https://huggingface.co/settings/tokens")
            token = input("Token: ").strip()
            if not token:
                print("❌ No token provided. Exiting.")
                return
            login(token=token, add_to_git_credential=True)

    api = HfApi(token=token)

    try:
        # Ensure the repository exists
        print(f"🔍 Checking if Space '{REPO_ID}' exists...")
        try:
            create_repo(
                repo_id=REPO_ID,
                repo_type="space",
                space_sdk="docker",
                exist_ok=True,
                token=token
            )
            print(f"✅ Space '{REPO_ID}' is ready.")
        except Exception as e:
            print(f"⚠️ Could not create/verify Space (might already exist or permission issue): {e}")

        print(f"📤 Uploading '{LOCAL_FOLDER}' to '{REPO_ID}'...")
        
        api.upload_folder(
            folder_path=LOCAL_FOLDER,
            repo_id=REPO_ID,
            repo_type="space",
            path_in_repo=".",
            ignore_patterns=["__pycache__", "*.pyc", ".env", ".DS_Store"],
            commit_message="Deploy backend via python script",
            token=token
        )
        
        print(f"✅ Deployment completed successfully!")
        print(f"🔗 View your Space here: https://huggingface.co/spaces/{REPO_ID}")
        
    except Exception as e:
        print(f"❌ Deployment failed: {e}")

if __name__ == "__main__":
    deploy()
