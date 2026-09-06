import { NextResponse } from 'next/server';

/**
 * Server-side Telugu Document OCR & Translation API.
 * API keys (OpenAI / Cloud Vision) are strictly isolated on the server
 * and NEVER exposed to client bundles.
 */

// Legal terminology dictionary for Andhra Pradesh & Telangana court practice
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { teluguText } = body;

    if (!teluguText || typeof teluguText !== 'string' || !teluguText.trim()) {
      return NextResponse.json(
        { error: 'Telugu text is required for translation.' },
        { status: 400 }
      );
    }

    const trimmed = teluguText.trim();

    // 1. If OPENAI_API_KEY is configured on server, use GPT-4o/GPT-3.5 for high accuracy legal translation
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key') {
      try {
        const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content:
                  'You are a certified legal translator specialized in Indian legal proceedings and Andhra Pradesh court documents. Translate the following Telugu court document/memo into accurate, formal Indian legal English. Preserve legal citations, dates, parties, and court numbers verbatim. Do not add speculative interpretations.',
              },
              { role: 'user', content: trimmed },
            ],
            temperature: 0.2,
          }),
        });

        if (aiResponse.ok) {
          const aiJson = await aiResponse.json();
          const translation = aiJson.choices?.[0]?.message?.content;
          if (translation) {
            return NextResponse.json({
              success: true,
              translatedText: translation.trim(),
              provider: 'openai',
              disclaimer:
                'Machine-generated translation — refer to the original Telugu text for any legally significant interpretation.',
            });
          }
        }
      } catch (err) {
        console.warn('OpenAI translation failed, falling back to rule-based legal translation:', err);
      }
    }

    // 2. Rule-based translation fallback for development, offline, or sandbox
    let translated = trimmed;
    for (const [tel, eng] of Object.entries(TELUGU_LEGAL_TERMS)) {
      translated = translated.split(tel).join(eng);
    }

    // Add contextual legal English translation phrasing
    const englishFallback = `[Legal Translation of Telugu Document]

Original Subject Matter: ${translated}

Notice: The court memo has been parsed with standardized Andhra Pradesh judicial terms.
Please review the verified Telugu text on the left panel before submitting formal filings in court.`;

    return NextResponse.json({
      success: true,
      translatedText: englishFallback,
      provider: 'local_legal_engine',
      disclaimer:
        'Machine-generated translation — refer to the original Telugu text for any legally significant interpretation.',
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal error processing document translation.' },
      { status: 500 }
    );
  }
}
