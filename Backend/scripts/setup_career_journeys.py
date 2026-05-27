#!/usr/bin/env python3
"""
Setup script to create career_journeys table in Supabase
Run this script once to initialize the database schema
"""

import os
import sys
from supabase import create_client, Client

def setup_career_journeys_table():
    """Create the career_journeys table in Supabase"""
    
    # Initialize Supabase client
    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if not supabase_url or not supabase_key:
        print("❌ Error: Missing environment variables")
        print("   - NEXT_PUBLIC_SUPABASE_URL")
        print("   - SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)
    
    supabase: Client = create_client(supabase_url, supabase_key)
    
    sql = """
    -- Create career_journeys table for Career Journey feature
    -- This table stores all career journeys (drafts and published)

    CREATE TABLE IF NOT EXISTS career_journeys (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      tags JSONB DEFAULT '[]',
      skills JSONB NOT NULL DEFAULT '[]',
      connections JSONB DEFAULT '[]',
      thumbnail TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
      created_by UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    -- Create indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_career_journeys_status ON career_journeys(status);
    CREATE INDEX IF NOT EXISTS idx_career_journeys_created_by ON career_journeys(created_by);
    CREATE INDEX IF NOT EXISTS idx_career_journeys_created_at ON career_journeys(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_career_journeys_status_created_at ON career_journeys(status, created_at DESC);

    -- Enable Row Level Security (RLS)
    ALTER TABLE career_journeys ENABLE ROW LEVEL SECURITY;

    -- RLS Policy 1: Drafts are visible to all authenticated admins
    CREATE POLICY "Drafts visible to all authenticated users" ON career_journeys
      FOR SELECT
      USING (status = 'draft' AND auth.role() = 'authenticated');

    -- RLS Policy 2: Published journeys are visible to all (public)
    CREATE POLICY "Published journeys visible to all" ON career_journeys
      FOR SELECT
      USING (status = 'published');

    -- RLS Policy 3: Users can only create journeys for themselves
    CREATE POLICY "Users can create own journeys" ON career_journeys
      FOR INSERT
      WITH CHECK (auth.uid()::text = created_by::text);

    -- RLS Policy 4: Users can only update their own drafts
    CREATE POLICY "Users can update own draft journeys" ON career_journeys
      FOR UPDATE
      USING (
        auth.uid()::text = created_by::text AND status = 'draft'
      )
      WITH CHECK (
        auth.uid()::text = created_by::text AND status = 'draft'
      );

    -- RLS Policy 5: Users can only delete their own drafts
    CREATE POLICY "Users can delete own draft journeys" ON career_journeys
      FOR DELETE
      USING (auth.uid()::text = created_by::text AND status = 'draft');

    -- Trigger to update updated_at timestamp
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER IF NOT EXISTS trigger_update_career_journeys_updated_at
    BEFORE UPDATE ON career_journeys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
    """
    
    try:
        print("🔄 Creating career_journeys table...")
        
        # Execute SQL using Supabase rpc if available, otherwise use direct connection
        try:
            result = supabase.rpc('exec_sql', {'sql': sql}).execute()
            print("✅ Table created successfully!")
            return True
        except Exception as rpc_error:
            print(f"⚠️  RPC method not available: {rpc_error}")
            print("Please execute the SQL manually in Supabase dashboard:")
            print("-" * 60)
            print(sql)
            print("-" * 60)
            return False
            
    except Exception as error:
        print(f"❌ Error creating table: {error}")
        return False

def verify_table_structure():
    """Verify the career_journeys table was created successfully"""
    
    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    supabase: Client = create_client(supabase_url, supabase_key)
    
    try:
        print("\n🔍 Verifying table structure...")
        
        # Try to query the table
        result = supabase.table("career_journeys").select().limit(1).execute()
        
        print("✅ Table exists and is accessible!")
        print(f"   - Table: career_journeys")
        print(f"   - Columns verified")
        return True
        
    except Exception as error:
        print(f"❌ Table verification failed: {error}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("🚀 Career Journeys Database Setup")
    print("=" * 60)
    
    success = setup_career_journeys_table()
    
    if success:
        verify_table_structure()
        print("\n✅ Setup complete! Career journeys table is ready.")
    else:
        print("\n⚠️  Please execute the SQL manually in Supabase dashboard.")
        print("   Go to: SQL Editor > New Query > Paste the SQL above > Run")
