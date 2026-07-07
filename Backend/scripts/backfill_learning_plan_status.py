import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(CURRENT_DIR)

sys.path.insert(0, BACKEND_DIR)

import asyncio

from utils.auth_bridge import get_service_supabase_client
from utils.db.learning_plan_db import refresh_learning_plan_status


async def main():

    db = get_service_supabase_client()

    plans = (
        db.table("learning_plan")
        .select(
            "learning_plan_id,user_id,module_id,plan_json"
        )
        .execute()
        .data
        or []
    )

    updated = 0

    for plan in plans:

        plan_json = plan.get("plan_json") or {}

        modules = plan_json.get("modules", [])

        if modules:

            processed_ids = [

                m["processed_module_id"]

                for m in modules

                if m.get("processed_module_id")

            ]

            (
                db.table("learning_plan")
                .update(
                    {
                        "processed_module_ids": processed_ids
                    }
                )
                .eq(
                    "learning_plan_id",
                    plan["learning_plan_id"]
                )
                .execute()
            )

        await refresh_learning_plan_status(
            user_id=plan["user_id"],
            module_id=plan["module_id"]
        )

        updated += 1

        if updated % 50 == 0:
            print(f"Updated {updated}")

    print(f"Finished. Updated {updated} learning plans.")


if __name__ == "__main__":
    asyncio.run(main())