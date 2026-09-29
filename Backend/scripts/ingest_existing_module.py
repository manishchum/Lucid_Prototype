import sys
import os
import argparse
import asyncio

# Add parent directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from ingestion.processed_module_rag import ingest_processed_module_vectors
from utils.supabase_client import supabase_admin


async def test_ingestion(processed_module_id: str = None, module_id: str = None, all_modules: bool = False):
    target_ids = []

    if all_modules:
        print("Fetching all existing processed modules from database...")
        res = (
            supabase_admin
            .table("processed_modules")
            .select("processed_module_id, title")
            .execute()
        )
        data = getattr(res, "data", []) or []
        for row in data:
            print(f"Found processed module: '{row.get('title')}' ({row.get('processed_module_id')})")
            target_ids.append(row.get("processed_module_id"))
    elif processed_module_id:
        target_ids.append(processed_module_id)
    elif module_id:
        print(f"Fetching processed modules for sprint module_id: {module_id}")
        res = (
            supabase_admin
            .table("processed_modules")
            .select("processed_module_id, title")
            .eq("original_module_id", module_id)
            .execute()
        )
        data = getattr(res, "data", []) or []
        for row in data:
            print(f"Found processed module: '{row.get('title')}' ({row.get('processed_module_id')})")
            target_ids.append(row.get("processed_module_id"))
    
    if not target_ids:
        print("[ERROR] No target processed_module_id found!")
        return

    print(f"\nFound {len(target_ids)} target modules to ingest...")
    for idx, pid in enumerate(target_ids, 1):
        print(f"\n==========================================")
        print(f"[{idx}/{len(target_ids)}] Ingesting & generating Q&A vectors for: {pid}")
        print(f"==========================================")
        try:
            result = await ingest_processed_module_vectors(pid)
            print("Ingestion Result:", result)
        except Exception as err:
            print(f"[ERROR] Failed to ingest {pid}: {err}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate Q&A vector embeddings for existing modules")
    parser.add_argument("--processed_module_id", type=str, help="Specific processed module ID to ingest")
    parser.add_argument("--module_id", type=str, help="Sprint module ID to ingest all child processed modules")
    parser.add_argument("--all", action="store_true", help="Ingest ALL existing processed modules in database")
    args = parser.parse_args()

    if not args.processed_module_id and not args.module_id and not args.all:
        print("Usage examples:")
        print("  python scripts/ingest_existing_module.py --all")
        print("  python scripts/ingest_existing_module.py --processed_module_id <PROCESSED_MODULE_ID>")
        print("  python scripts/ingest_existing_module.py --module_id <ORIGINAL_MODULE_ID>")
    else:
        asyncio.run(test_ingestion(
            processed_module_id=args.processed_module_id,
            module_id=args.module_id,
            all_modules=args.all
        ))
