import { NextResponse } from 'next/server';
import { translateText, isSarvamConfigured } from '@/lib/sarvam';

/**
 * Server side Telugu / Hindi / English translation API.
 *
 * Provider priority:
 *   1. Sarvam AI (mayura:v1) — when SARVAM_API_KEY is set. India-first,
 *      supports formal legal register, handles Telugu/Hindi natively.
 *   2. OpenAI (gpt-4o-mini) — fallback when SARVAM_API_KEY is absent
 *      but OPENAI_API_KEY is present.
 *   3. Word-level dictionary fallback — only when allow_fallback=true and
 *      no AI provider is configured. Not suitable for full sentence translation.
 *
 * All keys stay on the server and are NEVER exposed to the browser bundle.
 *
 * Response contract (unchanged from v1 so all callers keep working):
 *   { success: true; translatedText: string; translated_text: string; provider: string }
 *   or { error: string; provider?: string }
 */

// Optional word-level fallback dictionary for common legal terms.
// Only used with allow_fallback=true when no AI provider is available.
const TELUGU_LEGAL_TERMS: Record<string, string> = {
  'న్యాయస్థానం': 'Court of Law',
  'కోర్టు': 'Court',
  'జిల్లా కోర్టు': 'District Court',
  'హైకోర్టు': 'High Court',
  'ఫిర్యాదుదారు': 'Complainant / Plaintiff',
  'వాది': 'Plaintiff / Petitioner',
  'ప్రతివాది': 'Defendant / Respondent',
  'ముద్దాయి': 'Accused / Respondent',
  'తీర్పు': 'Judgment / Order',
  'వాయిదా': 'Adjournment / Hearing Date',
  'హాజరు': 'Appearance / Presence',
  'నోటీసు': 'Legal Notice',
  'బెయిల్': 'Bail',
  'సాక్ష్యం': 'Evidence / Deposition',
  'దస్తావేజు': 'Document / Deed',
  'వకాలత్': 'Vakalatnama',
  'దావా': 'Civil Suit',
  'అఫిడవిట్': 'Affidavit',
  'పిటిషన్': 'Petition',
  'రిమాండ్': 'Remand',
  'జామీను': 'Surety / Bail Bond',
};

const LANG_LABEL: Record<string, string> = {
  te: 'Telugu', 'te-IN': 'Telugu',
  hi: 'Hindi',  'hi-IN': 'Hindi',
  en: 'English', 'en-IN': 'English',
};

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const sourceText =
    typeof body.text === 'string' ? body.text
    : typeof body.teluguText === 'string' ? body.teluguText
    : '';
  const sourceLang = typeof body.source_lang === 'string' ? body.source_lang : 'te';
  const targetLang = typeof body.target_lang === 'string' ? body.target_lang : 'en';
  const allowFallback = body.allow_fallback === true;

  if (!sourceText.trim()) {
    return NextResponse.json({ error: 'Text is required for translation.' }, { status: 400 });
  }

  const trimmed = sourceText.trim();
  const fromName = LANG_LABEL[sourceLang] || sourceLang;
  const toName = LANG_LABEL[targetLang] || targetLang;

  // ── 1. Sarvam AI (primary, India-first) ──────────────────────────────────
  if (isSarvamConfigured()) {
    const result = await translateText({
      text: trimmed,
      sourceLang,
      targetLang,
      mode: 'formal',  // Legal text always uses formal register
      isDemoMode: false,
    });

    if (result.ok) {
      const translation = result.data.translated_text;
      return NextResponse.json({
        success: true,
        translatedText: translation,
        translated_text: translation,
        provider: 'sarvam',
      });
    }

    // Surface rate limit / auth errors directly; fall through only for transient errors
    if (result.code === 'auth_error' || result.code === 'quota_exhausted' || result.code === 'not_configured') {
      return NextResponse.json({ error: result.message, provider: 'sarvam' }, { status: 503 });
    }

    if (result.code === 'rate_limited') {
      return NextResponse.json({ error: result.message, provider: 'sarvam' }, { status: 429 });
    }

    if (result.code === 'validation_error') {
      return NextResponse.json({ error: result.message, provider: 'sarvam' }, { status: 422 });
    }

    // Transient service error — fall through to OpenAI if available
    console.warn('[translate] Sarvam transient error, attempting OpenAI fallback:', result.message);
  }

  // ── 2. OpenAI fallback ────────────────────────────────────────────────────
  const openaiKey = process.env.OPENAI_API_KEY;
  const openaiKeyIsSet =
    !!openaiKey &&
    openaiKey.trim().length > 10 &&
    openaiKey !== 'your_openai_api_key' &&
    openaiKey.toLowerCase() !== 'your-openai-api-key';

  if (openaiKeyIsSet) {
    try {
      const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a certified legal translator specialised in Indian court practice. Translate the user's ${fromName} text into ${toName}. Preserve every citation, date, party name, number and section reference verbatim. Return ONLY the translated text. Do not add prefaces, notices, disclaimers, headings, or any other framing.`,
            },
            { role: 'user', content: trimmed },
          ],
          temperature: 0.2,
        }),
      });

      if (aiResponse.ok) {
        const aiJson = await aiResponse.json();
        const translation = aiJson.choices?.[0]?.message?.content?.trim();
        if (translation) {
          return NextResponse.json({
            success: true,
            translatedText: translation,
            translated_text: translation,
            provider: 'openai',
          });
        }
        return NextResponse.json(
          { error: 'OpenAI returned an empty translation. Try a shorter piece of text.' },
          { status: 502 },
        );
      }

      let providerError = `OpenAI request failed with status ${aiResponse.status}.`;
      try {
        const errBody = await aiResponse.json();
        if (errBody?.error?.message) providerError = `OpenAI: ${errBody.error.message}`;
      } catch {}
      console.error('[translate] OpenAI error:', providerError);
      return NextResponse.json({ error: providerError }, { status: 502 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OpenAI network error.';
      console.error('[translate] Network error:', msg);
      return NextResponse.json({ error: `Could not reach OpenAI: ${msg}` }, { status: 502 });
    }
  }

  // ── 3. Demo / Unconfigured Fallback ──────────────────────────────────────
  // When no API key is configured on the server (e.g. on cloud deployment before env vars are set),
  // return a mock translation preview so developers and demo users can test the UI end-to-end.
  const demoResult = await translateText({
    text: trimmed,
    sourceLang,
    targetLang,
    mode: 'formal',
    isDemoMode: true,
  });

  if (demoResult.ok) {
    return NextResponse.json({
      success: true,
      translatedText: demoResult.data.translated_text,
      translated_text: demoResult.data.translated_text,
      provider: 'demo',
      warning:
        'Demo Mode: No SARVAM_API_KEY found on this server. Add SARVAM_API_KEY in Vercel Project Settings → Environment Variables (or .env.local locally) to enable live AI translation.',
    });
  }

  if (!allowFallback) {
    return NextResponse.json(
      {
        error:
          'No translation provider is configured. Add SARVAM_API_KEY in environment variables.',
        provider: 'none',
      },
      { status: 503 },
    );
  }

  // ── 4. Word-level dictionary fallback (explicit opt-in only) ───────────────
  let translated = trimmed;
  for (const [tel, eng] of Object.entries(TELUGU_LEGAL_TERMS)) {
    translated = translated.split(tel).join(eng);
  }
  return NextResponse.json({
    success: true,
    translatedText: translated,
    translated_text: translated,
    provider: 'dictionary_fallback',
    warning:
      'Word-level dictionary substitution only. This is not a full sentence translation. Configure SARVAM_API_KEY for accurate translation.',
  });
}
