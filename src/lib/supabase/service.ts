/**
 * Privileged Supabase client using secret key.
 * SERVER-ONLY: Never import this in client-side components or browser bundles.
 * Used exclusively in server-side route handlers that need privileged access
 * for specific, audited operations (portal lookup, token invalidation, role stamping).
 */
import { createClient } from '@supabase/supabase-js';

let _serviceClient: ReturnType<typeof createClient> | null = null;

export function createServiceClient() {
  if (_serviceClient) return _serviceClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey ||
      supabaseUrl === 'https://placeholder.supabase.co' ||
      secretKey === 'placeholder-secret-key') {
    throw new Error(
      '[VakilDesk] SUPABASE_SECRET_KEY is not configured. ' +
      'Set it in .env.local and Vercel environment variables.'
    );
  }

  _serviceClient = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _serviceClient;
}
