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
  }
}
