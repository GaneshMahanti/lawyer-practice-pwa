import { NextResponse } from 'next/server';

/**
 * Server side Telugu / Hindi / English translation API.
 *
 * Behaviour:
 *   1. If OPENAI_API_KEY is present, calls GPT 4o mini as a legal translator.
 *      Returns ONLY the translated text — no wrappers, no notices.
 *   2. If OPENAI_API_KEY is missing or the OpenAI call errors, returns a
 *      clear structured error the UI can surface so the advocate knows
 *      exactly why the translation did not run. We no longer silently
 *      fall back to a decorative rule based output that gets inserted
 *      into diary notes.
 *
 * All keys stay on the server and are never exposed to the browser bundle.
 */

// Optional word level fallback dictionary for common legal terms in AP courts.
// Only used if the caller explicitly asks for `allow_fallback: true` and
// OpenAI is not available. Never enabled by default.
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
  te: 'Telugu',
  hi: 'Hindi',
  en: 'English',
};

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const sourceText = typeof body.text === 'string'
    ? body.text
    : typeof body.teluguText === 'string'
    ? body.teluguText
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

  // ── 1. OpenAI (preferred) ────────────────────────────────────────────────
  const key = process.env.OPENAI_API_KEY;
  const keyIsSet =
    !!key &&
    key.trim().length > 10 &&
    key !== 'your_openai_api_key' &&
    key.toLowerCase() !== 'your-openai-api-key';

  if (keyIsSet) {
    try {
      const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                `You are a certified legal translator specialised in Indian court practice. Translate the user's ${fromName} text into ${toName}. Preserve every citation, date, party name, number and section reference verbatim. Return ONLY the translated text. Do not add prefaces, notices, disclaimers, headings, or any other framing.`,
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

      // Surface the actual OpenAI error so the advocate knows why.
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

  // ── 2. No key configured. Do NOT invent output. ──────────────────────────
  if (!allowFallback) {
    return NextResponse.json(
      {
        error:
          'OPENAI_API_KEY is not set on the server. Add it to .env.local and restart the dev server to enable AI translation.',
        provider: 'none',
      },
      { status: 503 },
    );
  }

  // ── 3. Explicit opt in to word level fallback (rarely useful for full sentences) ──
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
      'Word level dictionary substitution only. This is not a full sentence translation. Configure OPENAI_API_KEY for accurate translation.',
  });
}
