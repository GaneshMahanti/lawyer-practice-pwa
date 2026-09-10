import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';
import { createServerClient } from '@supabase/ssr';

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return NextResponse.json({ error: 'Demo service unavailable' }, { status: 503 });
  }

  try {
    const service = createServiceClient() as any;
    const demoId = crypto.randomUUID();
    const demoEmail = `demo_${demoId.slice(0, 8)}_${Date.now()}@demo.vakildesk.internal`;
    const demoPassword = `DemoPass_${crypto.randomUUID()}`;

    // 1. Create isolated ephemeral demo user
    const { data: userData, error: createError } = await service.auth.admin.createUser({
      email: demoEmail,
      password: demoPassword,
      email_confirm: true,
      app_metadata: { role: 'demo', provider: 'anonymous', is_anonymous: true },
      user_metadata: { is_demo: true, display_name: 'Demo Advocate' },
    });

    if (createError || !userData.user) {
      console.error('Demo user creation failed:', createError?.message);
      return NextResponse.json({ error: 'Unable to initialize demo user' }, { status: 500 });
    }

    const userId = userData.user.id;

    // 2. Seed initial isolated sample data for this demo user
    const sampleClientId = crypto.randomUUID();
    const sampleMatterId = crypto.randomUUID();
    const hearingDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const hearingEndDate = new Date(Date.now() + (7 * 24 + 1) * 60 * 60 * 1000).toISOString();

    try {
      await service.from('demo_workspaces').upsert({ user_id: userId, reset_at: new Date().toISOString() });
      await service.from('profiles').upsert({
        user_id: userId,
        display_name: 'Demo Advocate',
        preferred_language: 'en',
        timezone: 'Asia/Kolkata',
        onboarding_completed: true,
      });
      await service.from('clients').insert({
        id: sampleClientId,
        owner_id: userId,
        name: 'Asha Rao (Sample)',
        phone: '9000000001',
        email: 'asha@example.test',
        case_reference: 'CC 12/2026',
        notes: 'Fictional demo client.',
        status: 'active',
        is_practice_active: true,
        preferred_language: 'en',
      });
      await service.from('matters').insert({
        id: sampleMatterId,
        owner_id: userId,
        client_id: sampleClientId,
        matter_number: 'CC 12/2026',
        title: 'Sample Consumer Matter',
        court_name: 'Demo District Court Complex, Visakhapatnam',
        matter_type: 'Consumer',
        case_type: 'Consumer Complaint',
        category: 'Consumer',
        status: 'Active',
        next_hearing_date: hearingDate,
        state: 'Andhra Pradesh',
        district: 'Visakhapatnam',
        court_complex: 'Visakhapatnam District Court Complex',
        case_year: new Date().getFullYear(),
      });
      await service.from('bookings').insert({
        owner_id: userId,
        client_id: sampleClientId,
        matter_id: sampleMatterId,
        start_at: hearingDate,
        end_at: hearingEndDate,
        timezone: 'Asia/Kolkata',
        purpose: 'Sample Consumer Matter',
        status: 'scheduled',
        notes: 'Hearing derived from matter next court date',
        source: 'matter_hearing',
      });
      await service.from('diary_entries').insert({
        owner_id: userId,
        client_id: sampleClientId,
        matter_id: sampleMatterId,
        entry_type: 'text',
        title: 'Sample diary note',
        content: 'Review fictional consumer matter before hearing.',
        transcript: 'Review fictional consumer matter before hearing.',
        transcription_status: 'completed',
        language: 'en',
      });
      await service.from('reminder_preferences').upsert({
        owner_id: userId,
        offsets_minutes: [1440, 120],
        in_app_enabled: true,
      });
    } catch (seedErr) {
      console.warn('Initial demo seed warning:', seedErr);
    }

    // 3. Authenticate with credentials and set cookies
    const response = NextResponse.json({
      success: true,
      email: demoEmail,
      password: demoPassword,
      userId,
    });

    const ssrClient = createServerClient(supabaseUrl, publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    const { error: signInError } = await ssrClient.auth.signInWithPassword({
      email: demoEmail,
      password: demoPassword,
    });

    if (signInError) {
      console.error('Demo auto-sign in error:', signInError.message);
    }

    return response;
  } catch (error) {
    console.error('Demo session creation exception:', error);
    return NextResponse.json({ error: 'Failed to create demo session' }, { status: 500 });
  }
}
