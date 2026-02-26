from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from supabase import create_client, Client
import bcrypt
import os

router = APIRouter()

supabase: Client = create_client(
    os.environ["NEXT_PUBLIC_SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"]
)


@router.post("/change-password")
async def POST(req: Request):
    try:
        body = await req.json()

        user_id = body.get("user_id")
        current_password = body.get("current_password")
        new_password = body.get("new_password")

        if not user_id or not current_password:
            return JSONResponse(
                {"error": "user_id and current_password are required"},
                status_code=400
            )

        # Fetch the user's current hashed password
        try:
            query = supabase.table("users") \
                .select("password") \
                .eq("user_id", user_id) \
                .single() \
                .execute()

            userData = query.data
            
            if not userData or not userData.get("password"):
                return JSONResponse(
                    {"error": "User not found or password not set"},
                    status_code=404
                )
        except Exception as fetch_error:
            print(f"Error fetching user: {fetch_error}")
            return JSONResponse(
                {"error": "User not found"},
                status_code=404
            )

        # Validate current password against bcrypt hash
        try:
            stored_password = userData["password"]
            
            # Check if the stored password is a bcrypt hash (starts with $2b$ or $2a$)
            if not stored_password.startswith(('$2b$', '$2a$')):
                print(f"Warning: Password for user {user_id} is not a bcrypt hash")
                return JSONResponse(
                    {"error": "Password format is invalid. Please contact administrator."},
                    status_code=500
                )
            
            # Compare current password with stored hash
            isMatch = bcrypt.checkpw(
                current_password.encode("utf-8"),
                stored_password.encode("utf-8")
            )

            if not isMatch:
                return JSONResponse(
                    {"error": "Current password is incorrect"},
                    status_code=401
                )
        except Exception as bcrypt_error:
            print(f"Error verifying password: {bcrypt_error}")
            return JSONResponse(
                {"error": "Error verifying current password"},
                status_code=500
            )

        # If no new password provided, just return success after validating current password
        if not new_password or not new_password.strip():
            return JSONResponse({
                "message": "Current password validated successfully",
                "validated": True
            })

        # Hash the new password with bcrypt
        try:
            hashedPassword = bcrypt.hashpw(
                new_password.encode("utf-8"),
                bcrypt.gensalt(10)
            ).decode("utf-8")
        except Exception as hash_error:
            print(f"Error hashing new password: {hash_error}")
            return JSONResponse(
                {"error": "Error processing new password"},
                status_code=500
            )

        # Update the password in the database
        try:
            updateQuery = supabase.table("users") \
                .update({"password": hashedPassword}) \
                .eq("user_id", user_id) \
                .execute()

            if not updateQuery.data:
                return JSONResponse(
                    {"error": "Failed to update password"},
                    status_code=500
                )
        except Exception as update_error:
            print(f"Error updating password: {update_error}")
            return JSONResponse(
                {"error": "Failed to update password"},
                status_code=500
            )

        return JSONResponse({
            "message": "Password changed successfully",
            "changed": True
        })

    except Exception as error:
        print(f"Change password unexpected error: {error}")
        import traceback
        traceback.print_exc()

        return JSONResponse(
            {"error": "Internal server error"},
            status_code=500
        )