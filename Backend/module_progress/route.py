import os
import json
from datetime import datetime
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from supabase import create_client, Client

router = APIRouter()

supabase: Client = create_client(
    os.environ["NEXT_PUBLIC_SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"]
)


@router.post("/module-progress")
async def POST(request: Request):
    try:
        body = await request.json()

        user_id = body.get("user_id")
        processed_module_id = body.get("processed_module_id")
        quiz_score = body.get("quiz_score")
        max_score = body.get("max_score")
        quiz_feedback = body.get("quiz_feedback")
        completed_at = body.get("completed_at")
        viewOnly = body.get("viewOnly")
        module_id = body.get("module_id")

        if not user_id or not processed_module_id:
            return JSONResponse(
                {"error": "Missing required fields: user_id or processed_module_id"},
                status_code=400
            )

        print("[module-progress] Recording progress:", {
            "user_id": user_id,
            "processed_module_id": processed_module_id,
            "quiz_score": quiz_score,
            "max_score": max_score,
            "module_id": module_id
        })

        print(processed_module_id)

        check_res = supabase.table("module_progress") \
            .select("module_progress_id, completed_at") \
            .eq("user_id", user_id) \
            .eq("processed_module_id", processed_module_id) \
            .execute()

        existingProgress = check_res.data
        checkError = getattr(check_res, "error", None)

        if checkError and getattr(checkError, "code", None) != "PGRST116":
            print("[module-progress] Error checking existing progress:", checkError)
            return JSONResponse(
                {"error": "Failed to check existing progress"},
                status_code=500
            )

        result = None

        progressData = {
            "user_id": user_id,
            "processed_module_id": processed_module_id,
            "quiz_score": quiz_score if quiz_score is not None else None,
            "quiz_feedback": quiz_feedback if quiz_feedback is not None else None,
            "completed_at": completed_at if completed_at is not None else None,
            "started_at": None if existingProgress and existingProgress[0].get("completed_at") else datetime.utcnow().isoformat()
        }

        if existingProgress:

            if viewOnly:
                return JSONResponse({
                    "success": True,
                    "message": "Module view logged (already started)",
                    "data": existingProgress
                })

            print("Inside the if")

            actualModuleId = module_id

            if not actualModuleId:
                pm_res = supabase.table("processed_modules") \
                    .select("module_id") \
                    .eq("processed_module_id", processed_module_id) \
                    .single() \
                    .execute()

                processedModule = pm_res.data
                pmError = getattr(pm_res, "error", None)

                if pmError:
                    print("[module-progress] Error fetching module_id from processed_modules:", pmError)
                else:
                    actualModuleId = processedModule.get("module_id") if processedModule else None

            updateData = {}

            if quiz_score is not None:
                updateData["quiz_score"] = progressData["quiz_score"]

            if quiz_feedback is not None:
                updateData["quiz_feedback"] = progressData["quiz_feedback"]

            threshold_res = supabase.table("training_modules") \
                .select("threshold_value") \
                .eq("module_id", actualModuleId) \
                .execute()

            threshold = threshold_res.data

            print("Module Id is :", actualModuleId)
            print("Update Data:", updateData)
            print("Threshold Value:", threshold)
            print("Max Score:", max_score)
            print("User Score:", quiz_score)
            print("existingProgress:", existingProgress)
            print("Module ID:", actualModuleId)
            print("Processed Module ID:", processed_module_id)

            if (
                quiz_score is not None
                and max_score
                and threshold
                and len(threshold) > 0
                and threshold[0].get("threshold_value")
            ):
                scorePercentage = (quiz_score / max_score) * 100

                if scorePercentage >= threshold[0]["threshold_value"]:
                    updateData["pass_status"] = True
                else:
                    updateData["pass_status"] = False

            updateData["completed_at"] = datetime.utcnow().isoformat()

            update_res = supabase.table("module_progress") \
                .update(updateData) \
                .eq("module_progress_id", existingProgress[0]["module_progress_id"]) \
                .execute()

            data = update_res.data
            error = getattr(update_res, "error", None)

            if error:
                print("[module-progress] Error updating progress:", error)
                return JSONResponse(
                    {"error": "Failed to update progress record"},
                    status_code=500
                )

            result = data

        else:
            create_res = supabase.table("module_progress") \
                .update(progressData) \
                .select() \
                .single() \
                .execute()

            data = create_res.data
            error = getattr(create_res, "error", None)

            if error:
                print("[module-progress] Error creating progress:", error)
                return JSONResponse(
                    {"error": "Failed to create progress record"},
                    status_code=500
                )

            result = data

        return JSONResponse({
            "success": True,
            "message": "Module progress recorded successfully",
            "data": result
        })

    except Exception as error:
        print("[module-progress] Error:", error)

        return JSONResponse(
            {
                "error": "Failed to record module progress",
                "details": str(error)
            },
            status_code=500
        )