import os
import sys

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(CURRENT_DIR, ".."))

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

print("BACKEND_DIR:", BACKEND_DIR)

import json
from collections import defaultdict

from utils.supabase_client import supabase_admin


def build_processed_lookup():
    """
    Build:
    {
        original_module_id: {
            title: {
                processed_module_id,
                original_module_id
            }
        }
    }
    """

    lookup = defaultdict(dict)

    rows = (
        supabase_admin
        .table("processed_modules")
        .select(
            "processed_module_id,"
            "original_module_id,"
            "title"
        )
        .execute()
    )

    for row in rows.data or []:

        original_module_id = row.get("original_module_id")
        title = (row.get("title") or "").strip().lower()

        if not original_module_id or not title:
            continue

        lookup[original_module_id][title] = {
            "processed_module_id": row["processed_module_id"],
            "original_module_id": original_module_id,
        }

    return lookup


def migrate_learning_plans():

    lookup = build_processed_lookup()

    plans = (
        supabase_admin
        .table("learning_plan")
        .select(
            "learning_plan_id,"
            "module_id,"
            "plan_json"
        )
        .execute()
    )

    updated_count = 0
    unmatched_modules = []

    for plan in plans.data or []:

        learning_plan_id = plan["learning_plan_id"]
        original_module_id = plan.get("module_id")
        plan_json = plan.get("plan_json")

        if not original_module_id:
            continue

        if not plan_json:
            continue

        modules = plan_json.get("modules", [])

        changed = False

        for module in modules:

            if module.get("processed_module_id"):
                continue

            title = (module.get("title") or "").strip().lower()

            match = (
                lookup
                .get(original_module_id, {})
                .get(title)
            )

            if not match:
                unmatched_modules.append({
                    "learning_plan_id": learning_plan_id,
                    "module_id": original_module_id,
                    "title": title
                })
                continue

            module["processed_module_id"] = (
                match["processed_module_id"]
            )

            module["original_module_id"] = (
                match["original_module_id"]
            )

            changed = True

        if not changed:
            continue

        (
            supabase_admin
            .table("learning_plan")
            .update({
                "plan_json": plan_json
            })
            .eq(
                "learning_plan_id",
                learning_plan_id
            )
            .execute()
            # print(learning_plan_id, json.dumps(modules, indent=2))
        )

        updated_count += 1

        print(
            f"Updated learning plan "
            f"{learning_plan_id}"
        )

    print(
        f"\nMigration complete."
        f"\nUpdated plans: {updated_count}"
    )
    
    print(f"Unmatched modules: {len(unmatched_modules)}")

    for item in unmatched_modules[:50]:
        print(item)


if __name__ == "__main__":
    migrate_learning_plans()