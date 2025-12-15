import os
import google.generativeai as genai
# ...existing imports...

# Replace OpenAI client initialization with Gemini
genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
model = genai.GenerativeModel('gemini-2.5-flash-lite')

# ...existing code...

# Update the API call method to use Gemini instead of OpenAI
def generate_response(prompt):
    try:
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        print(f"Error generating response: {e}")
        return None