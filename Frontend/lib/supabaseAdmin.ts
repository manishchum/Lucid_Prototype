import { createClient } from '@supabase/supabase-js';

// Server-side only Supabase client using the server key.
// Do NOT import this module from client-side code.
const supabaseServerKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseServerKey,
  { auth: { persistSession: false } }
);
