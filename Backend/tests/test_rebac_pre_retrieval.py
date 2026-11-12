# Backend/tests/test_rebac_pre_retrieval.py
"""
End-to-End ReBAC Permission Graph, Pre-Retrieval ACL Filtering, Cross-Team Sharing,
Explicit Deny Overrides, CDC Sync, and Text-to-SQL / RAG / Chat Isolation Tests.
"""

import os
import sys
import uuid
from unittest.mock import patch, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from security.rebac import (
    UserSecurityContext,
    _resolve_reporting_subtree,
    resolve_external_principals_to_users,
)
from routes.coach_upload import _doc_visible_to_ctx
from coach.tools.sql_tool import execute_coach_sql
from coach.tools.rag_tool import search_coach_knowledge
from routes.coach_chat import router as coach_chat_router
from utils.auth import RequestAuth, get_request_auth_required
from utils.redis_client import delete_cache_pattern


COMPANY_ID = str(uuid.uuid4())
MGR_A_ID = str(uuid.uuid4())
SUB_MGR_A_ID = str(uuid.uuid4())
EMP_A1_ID = str(uuid.uuid4())
EMP_A2_ID = str(uuid.uuid4())
MGR_B_ID = str(uuid.uuid4())
EMP_B1_ID = str(uuid.uuid4())


def test_reporting_subtree_bfs_handles_multi_hop_and_cycles():
    """BFS resolves direct and indirect reports while preventing cycles and excluding inactive users."""
    users = [
        {"user_id": MGR_A_ID, "manager_id": MGR_B_ID, "is_active": True},  # synthetic cycle check if B points to A
        {"user_id": SUB_MGR_A_ID, "manager_id": MGR_A_ID, "is_active": True},
        {"user_id": EMP_A1_ID, "manager_id": SUB_MGR_A_ID, "is_active": True},
        {"user_id": EMP_A2_ID, "manager_id": MGR_A_ID, "is_active": True},
        {"user_id": "inactive-emp", "manager_id": MGR_A_ID, "is_active": False},
        {"user_id": MGR_B_ID, "manager_id": EMP_A1_ID, "is_active": True},  # cycle edge back into Mgr A's tree
        {"user_id": EMP_B1_ID, "manager_id": "unrelated-mgr", "is_active": True},
    ]

    subtree = _resolve_reporting_subtree(MGR_A_ID, users)
    assert SUB_MGR_A_ID in subtree
    assert EMP_A1_ID in subtree
    assert EMP_A2_ID in subtree
    assert "inactive-emp" not in subtree
    assert EMP_B1_ID not in subtree
    assert MGR_A_ID not in subtree


def _principal_set(ctx: UserSecurityContext, doc: dict) -> bool:
    """Validates UserSecurityContext + document visibility helper across real-world sharing rules."""
    return _doc_visible_to_ctx(doc, ctx)


def test_manager_vs_employee_and_cross_team_and_deny_override():
    """
    Tests all core RBAC & Cross-Team requirements:
    1. Manager A queries Team A & direct reports, blocked from Manager B private notes.
    2. Employee A1 queries self docs & manager-authored coaching feedback (is_private_manager_note=False).
    3. Employee A1 is blocked from manager private notes (is_private_manager_note=True) & peer docs.
    4. Team A <-> Team B docs are isolated unless explicitly shared; deny_viewer always wins over team allow.
    """
    mgr_a = UserSecurityContext(
        user_id=MGR_A_ID,
        company_id=COMPANY_ID,
        role_level=2,
        role_name="MANAGER",
        is_active=True,
        is_admin=False,
        is_manager_or_above=True,
        principals=[f"user:{MGR_A_ID}", "team:teamA", f"mgr_tree:{MGR_A_ID}", f"company:{COMPANY_ID}"],
        team_ids=["teamA"],
        managed_employee_ids=[EMP_A1_ID, EMP_A2_ID],
        allowed_tiers=["public", "internal", "manager_restricted"],
    )

    emp_a1 = UserSecurityContext(
        user_id=EMP_A1_ID,
        company_id=COMPANY_ID,
        role_level=1,
        role_name="USER",
        is_active=True,
        is_admin=False,
        is_manager_or_above=False,
        principals=[f"user:{EMP_A1_ID}", "team:teamA", f"company:{COMPANY_ID}"],
        team_ids=["teamA"],
        managed_employee_ids=[],
        allowed_tiers=["public", "internal"],
    )

    emp_b1 = UserSecurityContext(
        user_id=EMP_B1_ID,
        company_id=COMPANY_ID,
        role_level=1,
        role_name="USER",
        is_active=True,
        is_admin=False,
        is_manager_or_above=False,
        principals=[f"user:{EMP_B1_ID}", "team:teamB", f"company:{COMPANY_ID}"],
        team_ids=["teamB"],
        managed_employee_ids=[],
        allowed_tiers=["public", "internal"],
    )

    # Doc 1: Manager A coaching feedback shared with Employee A1
    shared_feedback_doc = {
        "id": "doc-feedback-a1",
        "uploaded_by": MGR_A_ID,
        "author_user_id": MGR_A_ID,
        "target_employee_id": EMP_A1_ID,
        "is_private_manager_note": False,
        "sensitivity_tier": "internal",
        "acl_principals": [f"user:{MGR_A_ID}", f"user:{EMP_A1_ID}", f"mgr_tree:{MGR_A_ID}"],
        "deny_principals": [],
    }
    assert _principal_set(mgr_a, shared_feedback_doc) is True
    assert _principal_set(emp_a1, shared_feedback_doc) is True
    assert _principal_set(emp_b1, shared_feedback_doc) is False

    # Doc 2: Manager A private note about Employee A1
    private_note_doc = {
        "id": "doc-private-a1",
        "uploaded_by": MGR_A_ID,
        "author_user_id": MGR_A_ID,
        "target_employee_id": EMP_A1_ID,
        "is_private_manager_note": True,
        "sensitivity_tier": "manager_restricted",
        "acl_principals": [f"user:{MGR_A_ID}", f"mgr_tree:{MGR_A_ID}"],
        "deny_principals": [f"user:{EMP_A1_ID}"],
    }
    assert _principal_set(mgr_a, private_note_doc) is True
    assert _principal_set(emp_a1, private_note_doc) is False

    # Doc 3: Team A internal playbook (Team B cannot view unless shared)
    team_a_doc = {
        "id": "doc-team-a",
        "uploaded_by": MGR_A_ID,
        "sensitivity_tier": "internal",
        "acl_principals": ["team:teamA", f"user:{MGR_A_ID}"],
        "deny_principals": [],
    }
    assert _principal_set(emp_a1, team_a_doc) is True
    assert _principal_set(emp_b1, team_a_doc) is False

    # Doc 4: Cross-team shared doc (Team A <-> Team B) with explicit deny override on Emp A1
    cross_team_shared_doc = {
        "id": "doc-cross-team",
        "uploaded_by": MGR_A_ID,
        "sensitivity_tier": "internal",
        "acl_principals": ["team:teamA", "team:teamB"],
        "deny_principals": [f"user:{EMP_A1_ID}"],
    }
    assert _principal_set(emp_b1, cross_team_shared_doc) is True   # Team B can now query!
    assert _principal_set(emp_a1, cross_team_shared_doc) is False  # Explicit deny overrides teamA allow!


def test_sql_tool_blocks_restricted_tables_and_passes_acl_principals():
    """
    Verifies Text-to-SQL blocks unauthorized table queries (e.g. FROM users),
    allows JSONB keys named 'Users', and injects ACL principals + sensitivity tiers to the RPC.
    """
    emp_sec = {
        "has_context": True,
        "is_active": True,
        "is_admin": False,
        "role_level": 1,
        "user_id": EMP_A1_ID,
        "principals": [f"user:{EMP_A1_ID}", "team:teamA"],
        "allowed_tiers": ["public", "internal"],
    }

    mock_supa = MagicMock()
    mock_supa.rpc.return_value.execute.return_value = MagicMock(data=[
        {"employee_name": "Alice", "target_employee_id": EMP_B1_ID, "row_data": {"Cases": 42, "salary": 150000}}
    ])

    with patch("coach.tools.sql_tool.supabase_admin", mock_supa):
        # 1. Attempting to query users table -> blocked before RPC
        blocked = execute_coach_sql(
            company_id=COMPANY_ID,
            sql_query=f"SELECT * FROM public.users WHERE company_id = '{COMPANY_ID}'",
            security_ctx=emp_sec,
        )
        assert blocked["success"] is False
        assert "Security Policy Violation" in blocked["error"]
        mock_supa.rpc.assert_not_called()

        # 2. Valid spreadsheet query referencing JSONB key row_data->>'Users' -> succeeds + masks salary
        allowed = execute_coach_sql(
            company_id=COMPANY_ID,
            sql_query=f"SELECT employee_name, target_employee_id, row_data FROM coach_spreadsheet_rows WHERE company_id = '{COMPANY_ID}' AND (row_data->>'Users') = 'Active'",
            security_ctx=emp_sec,
        )
        assert allowed["success"] is True
        mock_supa.rpc.assert_called_once()
        rpc_name, rpc_args = mock_supa.rpc.call_args[0]
        assert rpc_name == "execute_coach_sql_query"
        assert rpc_args["p_user_principals"] == [f"user:{EMP_A1_ID}", "team:teamA"]
        assert rpc_args["p_is_admin"] is False
        assert rpc_args["p_allowed_sensitivity_tiers"] == ["public", "internal"]
        # Salary masked by Layer 2
        assert allowed["rows"][0]["row_data"]["salary"] == "[MASKED_RESTRICTED]"


def test_rag_tool_blocks_unauthorized_target_employee_and_forwards_principals():
    """RAG skips embedding/RPC when target_employee_id is unauthorized and passes ACL principals when authorized."""
    emp_sec = {
        "has_context": True,
        "is_active": True,
        "is_admin": False,
        "role_level": 1,
        "user_id": EMP_A1_ID,
        "email": "empA1@lucid.work",
        "principals": [f"user:{EMP_A1_ID}", "team:teamA"],
        "allowed_tiers": ["public", "internal"],
        "managed_employee_ids": [],
    }

    mock_supa = MagicMock()
    mock_supa.rpc.return_value.execute.return_value = MagicMock(data=[
        {
            "chunk_id": "c1",
            "document_id": "d1",
            "content": "Call colleague at +1-415-555-0199 or peer@lucid.work",
            "target_employee_id": EMP_A2_ID,
            "file_name": "Notes.pdf",
        }
    ])

    mock_model = MagicMock()
    mock_model.encode.return_value.tolist.return_value = [0.1, 0.2, 0.3]

    with patch("coach.tools.rag_tool.supabase_admin", mock_supa), \
         patch("coach.tools.rag_tool.get_model", return_value=mock_model) as mock_emb:
        # 1. Employee A1 tries to query peer Employee B1 -> blocked with empty list before embedding!
        denied_chunks = search_coach_knowledge(
            query="How is B1 doing?",
            company_id=COMPANY_ID,
            target_employee_id=EMP_B1_ID,
            security_ctx=emp_sec,
        )
        assert denied_chunks == []
        mock_emb.assert_not_called()

        # 2. Employee A1 queries own context -> RPC receives principals & masks peer phone/email in chunks
        ok_chunks = search_coach_knowledge(
            query="Team feedback notes",
            company_id=COMPANY_ID,
            target_employee_id=EMP_A1_ID,
            security_ctx=emp_sec,
        )
        assert len(ok_chunks) == 1
        rpc_args = mock_supa.rpc.call_args[0][1]
        assert rpc_args["p_user_principals"] == [f"user:{EMP_A1_ID}", "team:teamA"]
        assert "[MASKED_PHONE]" in ok_chunks[0]["content"]
        assert "[MASKED_EMAIL]" in ok_chunks[0]["content"]


def test_coach_chat_endpoint_enforces_cross_user_403_and_logs_audit():
    """POST /api/coach/chat blocks employee cross-user target_employee_id requests with 403."""
    test_app = FastAPI()
    test_app.include_router(coach_chat_router)
    test_app.dependency_overrides[get_request_auth_required] = lambda: RequestAuth(
        user_id=EMP_A1_ID, company_id=COMPANY_ID, email="empA1@lucid.work", source="test"
    )

    emp_ctx = UserSecurityContext(
        user_id=EMP_A1_ID,
        company_id=COMPANY_ID,
        email="empA1@lucid.work",
        role_level=1,
        role_name="USER",
        is_active=True,
        principals=[f"user:{EMP_A1_ID}", "team:teamA"],
        managed_employee_ids=[],
    )

    with patch("routes.coach_chat.resolve_user_principals", return_value=emp_ctx), \
         patch("routes.coach_chat._audit_coach_query") as mock_audit:
        client = TestClient(test_app)
        res = client.post("/api/coach/chat", json={
            "query": "Give me private feedback for Employee B1",
            "target_employee_id": EMP_B1_ID,
            "stream": False,
        })
        assert res.status_code == 403
        assert mock_audit.call_args[1]["action"] == "COACH_CROSS_USER_QUERY_BLOCKED"


def test_external_email_and_id_principal_resolution():
    """Dual-source sync maps external emails/IDs from user_external_identities and company roster cleanly."""
    mock_supa = MagicMock()

    class _FakeTable:
        def __init__(self, rows):
            self.rows = rows

        def select(self, *args, **kwargs):
            return self

        def eq(self, *args, **kwargs):
            return self

        def execute(self):
            return MagicMock(data=self.rows)

    def _router(tbl):
        if tbl == "users":
            return _FakeTable([
                {"user_id": EMP_A1_ID, "email": "alice@lucid.work", "is_active": True},
                {"user_id": "inactive-id", "email": "old@lucid.work", "is_active": False},
            ])
        if tbl == "user_external_identities":
            return _FakeTable([
                {"user_id": EMP_A2_ID, "provider": "slack", "external_email": "bob@personal.dev", "external_user_id": "U999BOB"}
            ])
        return _FakeTable([])

    mock_supa.table.side_effect = _router

    with patch("security.rebac.get_service_supabase_client", return_value=mock_supa):
        resolved = resolve_external_principals_to_users(
            company_id=COMPANY_ID,
            provider="slack",
            emails=["Alice@Lucid.work", "old@lucid.work", "bob@personal.dev"],
            external_ids=["U999BOB"],
        )
        assert EMP_A1_ID in resolved
        assert EMP_A2_ID in resolved
        assert "inactive-id" not in resolved


def test_redis_delete_cache_pattern_handles_empty_or_mocked_gracefully():
    """Smoke test verifying delete_cache_pattern does not raise even without live Redis."""
    deleted = delete_cache_pattern(f"acl:principals:{COMPANY_ID}:*")
    assert deleted is None or isinstance(deleted, int)


def test_list_coach_documents_legacy_schema_fallback_42703():
    """GET /api/coach/documents gracefully falls back when 20261112 columns are not yet migrated."""
    from routes.coach_upload import router as coach_upload_router, _COACH_DOCS_L1_CACHE

    _COACH_DOCS_L1_CACHE.clear()
    test_app = FastAPI()
    test_app.include_router(coach_upload_router)
    test_app.dependency_overrides[get_request_auth_required] = lambda: RequestAuth(
        user_id=MGR_A_ID, company_id=COMPANY_ID, email="mgrA@lucid.work", source="test"
    )

    mgr_ctx = UserSecurityContext(
        user_id=MGR_A_ID,
        company_id=COMPANY_ID,
        email="mgrA@lucid.work",
        role_level=2,
        role_name="Manager",
        is_active=True,
        is_admin=False,
        is_manager_or_above=True,
        principals=[f"user:{MGR_A_ID}", f"mgr_tree:{MGR_A_ID}", "team:teamA"],
        principals_hash="mgr-test-hash-42703",
        managed_employee_ids=[EMP_A1_ID],
    )

    class _FakeDocsQuery:
        def __init__(self, cols):
            self.cols = cols

        def eq(self, *a, **kw):
            return self

        def neq(self, *a, **kw):
            return self

        def ilike(self, *a, **kw):
            return self

        def order(self, *a, **kw):
            return self

        def limit(self, *a, **kw):
            return self

        def execute(self):
            if "author_user_id" in self.cols:
                raise Exception("{'message': 'column coach_uploaded_documents.author_user_id does not exist', 'code': '42703'}")
            return MagicMock(
                data=[
                    {
                        "id": "doc-legacy-1",
                        "file_name": "emp_review.pdf",
                        "file_type": "pdf",
                        "status": "completed",
                        "uploaded_by": MGR_A_ID,
                        "target_employee_id": EMP_A1_ID,
                        "parsed_metadata": {"chunks_count": 4},
                    },
                    {
                        "id": "doc-legacy-other",
                        "file_name": "other_team.pdf",
                        "file_type": "pdf",
                        "status": "completed",
                        "uploaded_by": EMP_B1_ID,
                        "target_employee_id": EMP_B1_ID,
                        "parsed_metadata": {"chunks_count": 2},
                    },
                ],
                count=2,
            )

    mock_supa = MagicMock()
    mock_supa.table.return_value.select.side_effect = lambda cols, **kw: _FakeDocsQuery(cols)

    with patch("routes.coach_upload.resolve_user_principals", return_value=mgr_ctx), \
         patch("routes.coach_upload.get_coach_docs_cached", return_value=None), \
         patch("routes.coach_upload.set_coach_docs_cached"), \
         patch("routes.coach_upload.supabase_admin", mock_supa):
        client = TestClient(test_app)
        res = client.get("/api/coach/documents?page=1&limit=25")
        assert res.status_code == 200
        body = res.json()
        assert body["total"] == 1
        assert body["documents"][0]["id"] == "doc-legacy-1"


def test_schema_inspector_masks_rows_without_typeerror_and_handles_legacy_schema():
    """schema_inspector calls mask_spreadsheet_rows_for_role cleanly and handles 42703 fallback."""
    from coach.schema_inspector import get_company_spreadsheet_schema, _SCHEMA_CACHE

    _SCHEMA_CACHE.clear()
    mgr_ctx = UserSecurityContext(
        user_id=MGR_A_ID,
        company_id=COMPANY_ID,
        email="mgrA@lucid.work",
        role_level=2,
        role_name="Manager",
        is_active=True,
        is_admin=False,
        is_manager_or_above=True,
        principals=[f"user:{MGR_A_ID}", f"scoped_emp:{EMP_A1_ID}"],
        principals_hash="schema-test-hash",
        managed_employee_ids=[EMP_A1_ID],
    )

    class _FakeTableQuery:
        def __init__(self, tbl, cols):
            self.tbl = tbl
            self.cols = cols

        def eq(self, *a, **kw):
            return self

        def in_(self, *a, **kw):
            return self

        def limit(self, *a, **kw):
            return self

        def execute(self):
            if "acl_principals" in self.cols or "author_user_id" in self.cols:
                raise Exception("{'message': 'column does not exist', 'code': '42703'}")
            if self.tbl == "coach_uploaded_documents":
                return MagicMock(data=[{
                    "id": "sheet-doc-1",
                    "file_name": "sales_q4.xlsx",
                    "file_type": "xlsx",
                    "document_period": "Q4",
                    "description": "Q4 Sheet",
                    "parsed_metadata": {"columns_by_sheet": {"Q4": ["employee_name", "salary", "score"]}},
                    "target_employee_id": EMP_A1_ID,
                    "uploaded_by": MGR_A_ID,
                }])
            return MagicMock(data=[{
                "sheet_name": "Q4",
                "document_id": "sheet-doc-1",
                "employee_name": "Alice",
                "target_employee_id": EMP_A1_ID,
                "row_data": {"salary": "120000", "score": 95},
            }])

    mock_supa = MagicMock()
    mock_supa.table.side_effect = lambda tbl: MagicMock(
        select=lambda cols, **kw: _FakeTableQuery(tbl, cols)
    )

    with patch("coach.schema_inspector.supabase_admin", mock_supa):
        schema = get_company_spreadsheet_schema(COMPANY_ID, force_refresh=True, security_ctx=mgr_ctx)
        assert schema["has_spreadsheet_data"] is True
        assert schema["sheets_count"] == 1
        sample = schema["sheets"]["Q4"]["sample_rows"][0]
        assert sample["score"] == 95
        assert sample["salary"] == "[MASKED_RESTRICTED]"


def test_redis_pool_capped_and_closes_cleanly():
    """Redis client caps pool size to avoid exhausting free/managed client limits and closes cleanly."""
    from utils.redis_client import redis_client, close_redis_client

    assert redis_client.connection_pool.max_connections <= 15
    close_redis_client()


