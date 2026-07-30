# ingestion/company_config.py
import os
from utils.supabase_client import supabase

# Default configurations (fallback)
DEFAULT_CONFIG = {
    'rag_chunk_size': 250,
    'rag_chunk_overlap': 40,
    'rag_temperature': 0.1,
    'rag_top_p': 1.0,
    'rag_max_output_tokens': 3400
}


def get_company_rag_config(company_id: str) -> dict:
    """
    Fetch company-specific RAG configurations from the companies table.
    Falls back to DEFAULT_CONFIG if not found or on error.
    
    Args:
        company_id: UUID of the company
        
    Returns:
        Dictionary with RAG configuration keys
    """
    try:
        res = (
            supabase
            .table("companies")
            .select(
                "rag_chunk_size,rag_chunk_overlap,rag_temperature,rag_top_p,rag_max_output_tokens"
            )
            .eq("company_id", company_id)
            .single()
            .execute()
        )
        
        if res.data:
            return res.data
        else:
            print(f"[CONFIG] No company config found for {company_id}, using defaults")
            return DEFAULT_CONFIG
            
    except Exception as e:
        print(f"[CONFIG] Error fetching company config for {company_id}: {str(e)}")
        print(f"[CONFIG] Falling back to defaults")
        return DEFAULT_CONFIG
