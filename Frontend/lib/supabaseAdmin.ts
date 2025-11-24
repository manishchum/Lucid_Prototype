import { createClient } from '@supabase/supabase-js';

// Server-side only Supabase client using the service role key.
// Do NOT import this module from client-side code.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false } }
);
