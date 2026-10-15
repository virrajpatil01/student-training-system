import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== "undefined" && process.env?.VITE_SUPABASE_URL) ||
  "https://zuxhwatwbwhruupujqeb.supabase.co";

const supabaseKey =
  (typeof import.meta !== "undefined" &&
    (import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env?.VITE_SUPABASE_KEY)) ||
  (typeof process !== "undefined" &&
    (process.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env?.VITE_SUPABASE_KEY)) ||
  "sb_publishable_SXBEPIeE2zKMnA0AW5EgvA_cEXWok1a";

export const supabase = createClient(supabaseUrl, supabaseKey);