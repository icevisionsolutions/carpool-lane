import { createClient } from "@supabase/supabase-js";

// These two values come from your Supabase project (Settings → API).
// On Vercel you'll set them as environment variables:
//   VITE_SUPABASE_URL  and  VITE_SUPABASE_ANON_KEY
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, anonKey);
