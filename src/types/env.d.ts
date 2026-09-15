declare namespace NodeJS {
  interface ProcessEnv {
    readonly NEXT_PUBLIC_SUPABASE_URL: string;
    readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
    readonly SUPABASE_SECRET_KEY?: string;
    readonly RAZORPAY_KEY_ID?: string;
    readonly RAZORPAY_KEY_SECRET?: string;
    readonly RAZORPAY_WEBHOOK_SECRET?: string;
    readonly OPENAI_API_KEY?: string;
    readonly TRANSCRIPTION_MODEL?: string;
    readonly WHATSAPP_BSP_PROVIDER?: string;
    readonly WHATSAPP_API_KEY?: string;
    readonly WHATSAPP_PHONE_NUMBER_ID?: string;
    readonly WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
    readonly NEXT_PUBLIC_APP_URL?: string;

    // ── Sarvam AI (SERVER-ONLY — never expose to browser) ───────────────────
    /** Sarvam API subscription key. Set in .env.local, never prefix with NEXT_PUBLIC_. */
    readonly SARVAM_API_KEY?: string;
    /** Override the Speech-to-Text model. Default: saaras:v2 */
    readonly SARVAM_STT_MODEL?: string;
    /** Override the Translation model. Default: mayura:v1 */
    readonly SARVAM_TRANSLATE_MODEL?: string;
    /** Override the Document AI model identifier if Sarvam adds versioning. Default: unset (API default). */
    readonly SARVAM_DOCAI_MODEL?: string;
    /** Override the Sarvam base URL. Default: https://api.sarvam.ai */
    readonly SARVAM_BASE_URL?: string;
  }
}
