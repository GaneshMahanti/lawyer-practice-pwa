/**
 * Service-role Supabase client.
 * SERVER-ONLY: Never import this in client-side components or browser bundles.
 * Used exclusively in /api/portal/* route handlers that need to bypass RLS
 * for specific, audited write operations (portal submission, token invalidation).
 */
import { createClient } from '@supabase/supabase-js';

let _serviceClient: ReturnType<typeof createClient> | null = null;

export function createServiceClient() {
  if (_serviceClient) return _serviceClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey ||
      supabaseUrl === 'https://placeholder.supabase.co' ||
      serviceRoleKey === 'placeholder-service-role-key') {
    throw new Error(
      '[VakilDesk] SUPABASE_SERVICE_ROLE_KEY is not configured. ' +
      'Set it in .env.local and Vercel environment variables.'
    );
  }

  _serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _serviceClient;
}
