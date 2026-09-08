'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Shield, BookOpen, MapPin, Phone, Award, CheckCircle } from 'lucide-react';
import type { SupportedLanguage } from '@/lib/types/database';

const STATE_BAR_COUNCILS = [
  'Bar Council of Andhra Pradesh',
  'Bar Council of Telangana',
  'Bar Council of Delhi',
  'Bar Council of Maharashtra & Goa',
  'Bar Council of Karnataka',
  'Bar Council of Tamil Nadu & Puducherry',
  'Bar Council of Uttar Pradesh',
  'Bar Council of West Bengal',
  'Bar Council of Kerala',
  'Bar Council of Bihar',
  'Bar Council of Punjab & Haryana',
  'Bar Council of Gujarat',
  'Bar Council of Rajasthan',
  'Bar Council of Madhya Pradesh',
  'Other State Bar Council',
];

const PRACTICE_AREAS = [
  'Civil Litigation',
  'Criminal Law',
  'Family & Matrimonial',
  'Property & Real Estate',
  'Constitutional Law',
  'Commercial & Corporate',
  'Cheque Bounce (Sec 138 NI Act)',
  'Consumer Protection',
  'Motor Accident Claims (MACT)',
  'Labour & Employment',
];

export default function LawyerOnboardingPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form Fields
  const [displayName, setDisplayName] = useState('');
  const [barNumber, setBarNumber] = useState('');
  const [stateBarCouncil, setStateBarCouncil] = useState(STATE_BAR_COUNCILS[0]);
  const [chamberAddress, setChamberAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedPracticeAreas, setSelectedPracticeAreas] = useState<string[]>(['Civil Litigation', 'Criminal Law']);
  const [preferredLang, setPreferredLang] = useState<SupportedLanguage>('en');

  useEffect(() => {
    async function checkExisting() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        // If developer, bypass onboarding immediately
        if (user?.app_metadata?.role === 'developer') {
          router.replace('/app');
          return;
        }

        // Prefill name if available
        if (user?.user_metadata?.full_name) {
          setDisplayName(user.user_metadata.full_name);
        }

        // Check if already onboarded
        if (user) {
          const { data: profile } = await (supabase as any)
            .from('profiles')
            .select('onboarding_completed, display_name, bar_council_number')
            .eq('user_id', user.id)
            .maybeSingle();

          if (profile?.onboarding_completed) {
            router.replace('/app');
            return;
          }
        }
      } catch (err) {
        console.error('Onboarding check error:', err);
      } finally {
        setLoading(false);
      }
    }
    checkExisting();
  }, [router]);

  const togglePracticeArea = (area: string) => {
    setSelectedPracticeAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Validations
    if (!displayName.trim()) {
      setErrorMsg('Please enter your full legal name.');
      return;
    }
    if (!barNumber.trim()) {
      setErrorMsg('Please enter your Bar Council Enrollment Number (e.g. AP/1245/2018).');
      return;
    }
    if (!city.trim()) {
      setErrorMsg('Please enter your practice city.');
      return;
    }
    if (!phone.trim() || !/^\d{10}$/.test(phone.replace(/\D/g, ''))) {
      setErrorMsg('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (selectedPracticeAreas.length === 0) {
      setErrorMsg('Please select at least one practice area.');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const profilePayload = {
        user_id: user?.id,
        display_name: displayName.trim(),
        bar_council_number: barNumber.trim(),
        state_bar_council: stateBarCouncil,
        chamber_address: chamberAddress.trim() || null,
        city: city.trim(),
        phone: phone.replace(/\D/g, ''),
        practice_areas: selectedPracticeAreas,
        preferred_language: preferredLang,
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      };

      // Upsert profile in Supabase if user exists
      if (user) {
        const { error: upsertError } = await (supabase as any)
          .from('profiles')
          .upsert(profilePayload, { onConflict: 'user_id' });

        if (upsertError) {
          console.error('Profile upsert error:', upsertError);
        }
      }

      // Also persist to localStorage for offline access
      try {
        localStorage.setItem('vakildesk_advocate_name', displayName.trim());
        localStorage.setItem('vakildesk_bar_no', barNumber.trim());
        localStorage.setItem('vakildesk_onboarding_completed', 'true');
        document.cookie = `vakildesk_advocate_name=${encodeURIComponent(displayName.trim())}; path=/; max-age=31536000; SameSite=Lax`;
        document.cookie = `vakildesk_bar_no=${encodeURIComponent(barNumber.trim())}; path=/; max-age=31536000; SameSite=Lax`;
      } catch {}

      router.push('/app');
      router.refresh();
    } catch (err) {
      console.error('Submission failed:', err);
      setErrorMsg('Failed to complete onboarding. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)', color: 'var(--text-muted)' }}>
        Loading onboarding profile…
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '32px 16px 64px',
      background: 'var(--bg-app)',
    }}>
      <div style={{ width: '100%', maxWidth: 600 }}>
        {/* Header Badge */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: 'linear-gradient(135deg, var(--accent-gold, #c8a03c), #9b722b)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px',
            color: '#fff',
            boxShadow: '0 4px 16px rgba(200,160,60,0.25)',
          }}>
            <Shield size={26} />
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '0 0 6px', color: 'var(--text-primary)' }}>
            Advocate Practice Onboarding
          </h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.88rem' }}>
            Set up your verified legal practice profile for VakilDesk.
          </p>
        </div>

        {errorMsg && (
          <div style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: 'rgba(220,50,50,0.1)',
            border: '1px solid rgba(220,50,50,0.3)',
            color: 'var(--status-danger)',
            fontSize: '0.88rem',
            marginBottom: 20,
          }}>
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Section 1: Professional Identity */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Award size={18} color="var(--accent-gold, #c8a03c)" />
              <span>Bar Council Credentials</span>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className="input-label" htmlFor="displayName">Full Legal Name *</label>
              <input
                id="displayName"
                type="text"
                required
                className="input-field"
                placeholder="e.g. Adv. R. K. Sharma"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label className="input-label" htmlFor="barNumber">Bar Council Enrollment Number *</label>
              <input
                id="barNumber"
                type="text"
                required
                className="input-field"
                placeholder="e.g. AP/1245/2018 or D/567/2015"
                value={barNumber}
                onChange={(e) => setBarNumber(e.target.value)}
              />
            </div>

            <div>
              <label className="input-label" htmlFor="stateBarCouncil">State Bar Council *</label>
              <select
                id="stateBarCouncil"
                className="input-field"
                value={stateBarCouncil}
                onChange={(e) => setStateBarCouncil(e.target.value)}
              >
                {STATE_BAR_COUNCILS.map((bc) => (
                  <option key={bc} value={bc}>{bc}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Section 2: Chamber & Contact */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <MapPin size={18} color="var(--accent-primary)" />
              <span>Chamber & Office Details</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label className="input-label" htmlFor="city">Practice City / District *</label>
                <input
                  id="city"
                  type="text"
                  required
                  className="input-field"
                  placeholder="e.g. Visakhapatnam"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
              <div>
                <label className="input-label" htmlFor="phone">Official Mobile Number *</label>
                <input
                  id="phone"
                  type="tel"
                  required
                  className="input-field"
                  placeholder="10-digit number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="input-label" htmlFor="chamberAddress">Chamber / Office Address</label>
              <textarea
                id="chamberAddress"
                rows={2}
                className="input-field"
                placeholder="Room / Chamber No., Court Complex / Law Chambers, Street"
                value={chamberAddress}
                onChange={(e) => setChamberAddress(e.target.value)}
              />
            </div>
          </div>

          {/* Section 3: Practice Areas & Language */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <BookOpen size={18} color="var(--accent-primary)" />
              <span>Practice Areas & Language</span>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label className="input-label" style={{ marginBottom: 8 }}>Select Practice Areas *</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {PRACTICE_AREAS.map((area) => {
                  const selected = selectedPracticeAreas.includes(area);
                  return (
                    <button
                      key={area}
                      type="button"
                      onClick={() => togglePracticeArea(area)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 20,
                        fontSize: '0.8rem',
                        border: selected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                        background: selected ? 'var(--accent-primary)' : 'var(--bg-surface-elevated)',
                        color: selected ? '#fff' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {area}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="input-label" htmlFor="preferredLang">Default Interface Language</label>
              <select
                id="preferredLang"
                className="input-field"
                value={preferredLang}
                onChange={(e) => setPreferredLang(e.target.value as SupportedLanguage)}
              >
                <option value="en">English</option>
                <option value="te">తెలుగు (Telugu)</option>
                <option value="hi">हिन्दी (Hindi)</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="action-btn action-btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '14px 0', fontSize: '1rem', marginTop: 8 }}
            disabled={submitting}
          >
            {submitting ? 'Verifying & Saving Profile…' : 'Complete Onboarding & Enter VakilDesk →'}
          </button>
        </form>
      </div>
    </div>
  );
}
