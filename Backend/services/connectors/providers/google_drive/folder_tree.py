# Backend/services/connectors/providers/google_drive/folder_tree.py
"""
Folder Hierarchy, Shared Folders, Shared Drives, and Ancestor Resolution Engine for Google Drive.
Supports lazy-loaded browsing, "Shared with me" folders, deep parallel recursive subtree mapping,
and ancestor validation.
"""

import asyncio
from typing import List, Dict, Any, Optional, Set, Tuple
from services.connectors.models import ContainerItem
from services.connectors.providers.google_drive.client import (
    GOOGLE_DRIVE_API_BASE,
    execute_google_api_call
)


async def list_shared_drives(access_token: str) -> List[ContainerItem]:
    """
    Fetches all Google Workspace Shared Drives (Team Drives) the user has access to.
    """
    params = {
        "pageSize": 100,
        "fields": "drives(id, name)"
    }
    res = await execute_google_api_call(
        method="GET",
        url=f"{GOOGLE_DRIVE_API_BASE}/drives",
        access_token=access_token,
        params=params
    )

    if res.status_code != 200:
        print(f"[GOOGLE DRIVE] Note: Shared drives lookup returned status {res.status_code}")
        return []

    data = res.json()
    drives = data.get("drives", [])
    items: List[ContainerItem] = []
    for d in drives:
        items.append(
            ContainerItem(
                id=d["id"],
                name=d["name"],
                container_type="shared_drive",
                parent_id=None,
                path=f"/Shared Drives/{d['name']}",
                drive_id=d["id"],
                drive_name=d["name"],
                has_children=True,
                can_select=True,
                metadata={"is_shared_drive_root": True}
            )
        )
    return items


async def list_shared_with_me_folders(access_token: str) -> List[ContainerItem]:
    """
    Fetches all folders that have been directly shared with the user ('Shared with me').
    """
    query = "sharedWithMe = true and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    params = {
        "q": query,
        "fields": "nextPageToken, files(id, name, driveId)",
        "pageSize": 100,
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true"
    }
    res = await execute_google_api_call(
        method="GET",
        url=f"{GOOGLE_DRIVE_API_BASE}/files",
        access_token=access_token,
        params=params
    )
    if res.status_code != 200:
        print(f"[GOOGLE DRIVE] Note: Shared with me folders lookup error: {res.text}")
        return []

    data = res.json()
    files = data.get("files", [])
    items: List[ContainerItem] = []
    for f in files:
        f_name = f.get("name", "Untitled Folder")
        items.append(
            ContainerItem(
                id=f["id"],
                name=f_name,
                container_type="folder",
                parent_id="shared_with_me",
                path=f"/Shared with me/{f_name}",
                drive_id=f.get("driveId"),
                has_children=True,
                can_select=True,
                metadata={"is_shared_with_me": True}
            )
        )
    items.sort(key=lambda x: x.name.lower())
    return items


async def list_child_folders(
    access_token: str,
    parent_id: Optional[str] = None,
    drive_id: Optional[str] = None,
    current_path: str = "/"
) -> List[ContainerItem]:
    """
    Lists direct child folders under a given parent folder, drive, or 'Shared with me'.
    Supports personal My Drive, Shared with me, and enterprise Shared Drives.
    """
    # If the user clicked into "Shared with me", return the shared folders directly
    if parent_id == "shared_with_me":
        return await list_shared_with_me_folders(access_token)

    target_parent = parent_id or (drive_id if drive_id else "root")

    query_parts = [
        "mimeType = 'application/vnd.google-apps.folder'",
        f"'{target_parent}' in parents",
        "trashed = false"
    ]
    query = " and ".join(query_parts)

    params: Dict[str, Any] = {
        "q": query,
        "fields": "nextPageToken, files(id, name, parents, driveId)",
        "pageSize": 100,
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true"
    }

    if drive_id:
        params["corpora"] = "drive"
        params["driveId"] = drive_id

    items: List[ContainerItem] = []
    page_token = None

    while True:
        if page_token:
            params["pageToken"] = page_token

        res = await execute_google_api_call(
            method="GET",
            url=f"{GOOGLE_DRIVE_API_BASE}/files",
            access_token=access_token,
            params=params
        )

        if res.status_code != 200:
            print(f"[GOOGLE DRIVE] Error listing child folders for parent {target_parent}: {res.text}")
            break

        data = res.json()
        files = data.get("files", [])

        for f in files:
            f_name = f.get("name", "Untitled Folder")
            f_id = f["id"]
            clean_path = f"{current_path.rstrip('/')}/{f_name}"
            items.append(
                ContainerItem(
                    id=f_id,
                    name=f_name,
                    container_type="folder",
                    parent_id=target_parent,
                    path=clean_path,
                    drive_id=drive_id or f.get("driveId"),
                    has_children=True,
                    can_select=True,
                    metadata={"drive_id": drive_id or f.get("driveId")}
                )
            )

        page_token = data.get("nextPageToken")
        if not page_token or len(items) >= 200:
            break

    # Sort alphabetically by name
    items.sort(key=lambda x: x.name.lower())
    return items


async def list_files_in_folder(
    access_token: str,
    parent_id: Optional[str] = None,
    drive_id: Optional[str] = None,
    max_files: int = 150
) -> List[Dict[str, Any]]:
    """
    Lists non-folder files inside a given parent folder.
    Supports My Drive, Shared with me folders, and Google Workspace Shared Drives.
    """
    if parent_id == "shared_with_me":
        query = "sharedWithMe = true and mimeType != 'application/vnd.google-apps.folder' and trashed = false"
    else:
        target_parent = parent_id or (drive_id if drive_id else "root")
        query = f"'{target_parent}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false"

    params: Dict[str, Any] = {
        "q": query,
        "fields": "nextPageToken, files(id, name, mimeType, size, modifiedTime, iconLink, webViewLink)",
        "pageSize": min(max_files, 100),
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true"
    }

    if drive_id and parent_id != "shared_with_me":
        params["corpora"] = "drive"
        params["driveId"] = drive_id

    files_list: List[Dict[str, Any]] = []
    page_token = None

    while True:
        if page_token:
            params["pageToken"] = page_token

        res = await execute_google_api_call(
            method="GET",
            url=f"{GOOGLE_DRIVE_API_BASE}/files",
            access_token=access_token,
            params=params
        )

        if res.status_code != 200:
            print(f"[GOOGLE DRIVE] Note: Error listing files for folder {parent_id}: {res.text}")
            break

        data = res.json()
        for f in data.get("files", []):
            mime = f.get("mimeType", "")
            raw_name = f.get("name", "Untitled")

            ext = ""
            if "." in raw_name:
                ext = raw_name.rsplit(".", 1)[-1].lower()
            elif mime == "application/vnd.google-apps.document":
                ext = "gdoc"
            elif mime == "application/vnd.google-apps.spreadsheet":
                ext = "gsheet"
            elif mime == "application/vnd.google-apps.presentation":
                ext = "gslides"
            elif "pdf" in mime:
                ext = "pdf"
            elif "sheet" in mime or "excel" in mime:
                ext = "xlsx"
            elif "word" in mime or "document" in mime:
                ext = "docx"

            is_gdoc = mime.startswith("application/vnd.google-apps.") and ext in ("gdoc", "gsheet", "gslides")

            # Determine whether AI Coach can ingest this file type
            is_supported = (
                ext in {"pdf", "docx", "doc", "csv", "xlsx", "xls", "pptx", "ppt"} or
                mime in {
                    "application/vnd.google-apps.document",
                    "application/vnd.google-apps.spreadsheet",
                    "application/vnd.google-apps.presentation",
                    "application/pdf",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/msword",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "application/vnd.ms-excel",
                    "text/csv",
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    "application/vnd.ms-powerpoint"
                }
            )

            export_format = None
            if mime == "application/vnd.google-apps.document":
                export_format = "pdf"
            elif mime == "application/vnd.google-apps.spreadsheet":
                export_format = "xlsx"
            elif mime == "application/vnd.google-apps.presentation":
                export_format = "pptx"

            category = "other"
            if ext in ("pdf", "docx", "doc", "gdoc") or "word" in mime or "pdf" in mime:
                category = "document"
            elif ext in ("xlsx", "xls", "csv", "gsheet") or "sheet" in mime or "excel" in mime or "csv" in mime:
                category = "spreadsheet"
            elif ext in ("pptx", "ppt", "gslides") or "presentation" in mime:
                category = "presentation"
            elif ext in ("png", "jpg", "jpeg", "svg", "webp", "gif") or "image" in mime:
                category = "image"
            elif ext in ("mp4", "mov", "avi", "mkv", "webm") or "video" in mime:
                category = "video"
            elif ext in ("zip", "tar", "gz", "7z", "rar"):
                category = "archive"

            raw_size = f.get("size")
            size_bytes = int(raw_size) if raw_size is not None else 0

            files_list.append({
                "id": f["id"],
                "name": raw_name,
                "mime_type": mime,
                "extension": ext,
                "size_bytes": size_bytes,
                "modified_time": f.get("modifiedTime"),
                "icon_link": f.get("iconLink"),
                "web_view_link": f.get("webViewLink"),
                "is_google_doc": is_gdoc,
                "is_supported": is_supported,
                "export_format": export_format,
                "category": category
            })

        page_token = data.get("nextPageToken")
        if not page_token or len(files_list) >= max_files:
            break

    files_list.sort(key=lambda x: (not x["is_supported"], x["name"].lower()))
    return files_list


async def fetch_folder_metadata(
    access_token: str,
    folder_id: str
) -> Optional[Dict[str, Any]]:
    """Retrieves single folder info (name, parents, driveId)."""
    params = {
        "fields": "id, name, mimeType, parents, driveId",
        "supportsAllDrives": "true"
    }
    res = await execute_google_api_call(
        method="GET",
        url=f"{GOOGLE_DRIVE_API_BASE}/files/{folder_id}",
        access_token=access_token,
        params=params
    )
    if res.status_code == 200:
        return res.json()
    return None


async def build_folder_subtree_map(
    access_token: str,
    root_folder_id: str,
    drive_id: Optional[str] = None,
    max_depth: int = 12,
    max_folders: int = 2500,
    concurrency: int = 10
) -> Dict[str, Dict[str, Any]]:
    """
    Traverses the folder hierarchy recursively starting from root_folder_id.
    Optimized with level-by-level parallel async requests.
    Returns a dictionary mapping:
    {
       folder_id: {
          "id": folder_id,
          "name": folder_name,
          "parent_id": parent_folder_id,
          "relative_path": "Subfolder/Nested"
       }
    }
    """
    subtree: Dict[str, Dict[str, Any]] = {}
    
    # Root entry
    root_info = await fetch_folder_metadata(access_token, root_folder_id)
    root_name = root_info.get("name", "Root") if root_info else "Root"
    subtree[root_folder_id] = {
        "id": root_folder_id,
        "name": root_name,
        "parent_id": None,
        "relative_path": ""
    }

    # Queue of folders at current level: (folder_id, relative_path)
    current_level: List[Tuple[str, str]] = [(root_folder_id, "")]
    depth = 0
    sem = asyncio.Semaphore(concurrency)

    async def _fetch_children(parent_fid: str, parent_rel_path: str) -> List[Tuple[str, str, str]]:
        """Fetches direct child folders of parent_fid concurrently."""
        async with sem:
            query = f"mimeType = 'application/vnd.google-apps.folder' and '{parent_fid}' in parents and trashed = false"
            params: Dict[str, Any] = {
                "q": query,
                "fields": "nextPageToken, files(id, name, driveId)",
                "pageSize": 100,
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true"
            }
            if drive_id:
                params["corpora"] = "drive"
                params["driveId"] = drive_id

            discovered = []
            page_token = None
            while True:
                if page_token:
                    params["pageToken"] = page_token

                res = await execute_google_api_call(
                    method="GET",
                    url=f"{GOOGLE_DRIVE_API_BASE}/files",
                    access_token=access_token,
                    params=params
                )
                if res.status_code != 200:
                    break

                data = res.json()
                child_folders = data.get("files", [])
                for cf in child_folders:
                    cid = cf["id"]
                    cname = cf.get("name", "Folder")
                    child_rel = f"{parent_rel_path}/{cname}".strip("/")
                    discovered.append((cid, cname, child_rel))

                page_token = data.get("nextPageToken")
                if not page_token:
                    break

            return [(parent_fid, cid, cname, child_rel) for cid, cname, child_rel in discovered]

    while current_level and depth < max_depth and len(subtree) < max_folders:
        tasks = [_fetch_children(fid, rel_path) for fid, rel_path in current_level]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        next_level: List[Tuple[str, str]] = []
        for res in results:
            if isinstance(res, list):
                for parent_fid, cid, cname, child_rel in res:
                    if cid not in subtree:
                        subtree[cid] = {
                            "id": cid,
                            "name": cname,
                            "parent_id": parent_fid,
                            "relative_path": child_rel
                        }
                        next_level.append((cid, child_rel))

        current_level = next_level
        depth += 1

    return subtree


async def is_item_descendant_of(
    access_token: str,
    item_parent_ids: List[str],
    root_folder_id: str,
    known_subtree_ids: Set[str],
    max_hops: int = 10
) -> bool:
    """
    Determines if an item belongs to the monitored subtree.
    First checks immediate parents against known_subtree_ids.
    If not found (e.g. newly created subfolder), ascends parent pointers.
    """
    if not item_parent_ids:
        return False

    # Fast path: check against known cached subtree
    for pid in item_parent_ids:
        if pid == root_folder_id or pid in known_subtree_ids:
            return True

    # Slow path: climb up hierarchy
    current_check = list(item_parent_ids)
    visited: Set[str] = set()

    for _ in range(max_hops):
        if not current_check:
            break
        pid = current_check.pop(0)
        if pid in visited:
            continue
        visited.add(pid)

        if pid == root_folder_id or pid in known_subtree_ids:
            return True

        # Fetch parent's parents
        meta = await fetch_folder_metadata(access_token, pid)
        if not meta:
            continue
        parents = meta.get("parents", [])
        for p in parents:
            if p == root_folder_id or p in known_subtree_ids:
                return True
            if p not in visited:
                current_check.append(p)

    return False
