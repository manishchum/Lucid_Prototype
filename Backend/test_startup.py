# import os
# from dotenv import load_dotenv

# print("1. Loading environment...")
# load_dotenv()

# print("2. Checking required env vars...")
# required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY"]
# for var in required:
#     value = os.getenv(var)
#     print(f"   {var}: {'✓ Set' if value else '✗ Missing'}")

# print("3. Testing Supabase connection...")
# try:
#     from utils.supabase_client import supabase
#     result = supabase.table("users").select("user_id").limit(1).execute()
#     print("   ✓ Supabase connected")
# except Exception as e:
#     print(f"   ✗ Supabase error: {e}")

# print("4. Testing imports...")

# try:
#     from gpt_video_generation.route import router as video_router
#     print("   ✓ gpt_video_generation")
# except Exception as e:
#     print(f"   ✗ gpt_video_generation: {e}")
# try:
#     from openai_upload.route import router as openai_upload_router
#     print("   ✓ openai_upload")
# except Exception as e:
#     print(f"   ✗ openai_upload: {e}")



# print("\n5. All checks complete!")


# from sentence_transformers import SentenceTransformer
# import os

# print("Downloading embedding model...")
# print("This is a one-time download of ~80MB")
# print("Model will be cached for future use")

# model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
# print(f"✓ Model downloaded successfully to: {model._model_card_vars['model_name']}")
# print("You can now start the backend server!")

from sentence_transformers import SentenceTransformer
import os

print("Downloading embedding model...")
print("This is a one-time download of ~1.34GB for BAAI/bge-large-en-v1.5")
print("Model will be cached for future use")

# Download the actual model you're using in embedder.py
model = SentenceTransformer('BAAI/bge-large-en-v1.5', device='cpu')
print(f"✓ Model downloaded successfully!")
print(f"✓ Cache location: {os.path.join(os.path.expanduser('~'), '.cache', 'huggingface', 'hub')}")
print("\nYou can now start the backend server!")

# Test encoding to verify it works
test_text = "This is a test"
embedding = model.encode(test_text)
print(f"✓ Test encoding successful! Embedding dimension: {len(embedding)}")