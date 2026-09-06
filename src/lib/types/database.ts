// ==============================================================================
// VakilDesk Database & Domain Types
// Aligned with Supabase PostgreSQL Schema
// ==============================================================================

export type SupportedLanguage = 'en' | 'hi' | 'te';

export type MatterStatus =
  | 'Intake'
  | 'Active'
  | 'Pending Hearing'
  | 'Reserved for Judgment'
  | 'Disposed/Closed'
  | 'Archived';

export type BookingStatus = 'scheduled' | 'completed' | 'adjourned' | 'cancelled';

export type InvoiceStatus =
  | 'draft'
  | 'issued'
  | 'partially_paid'
  | 'paid'
  | 'cancelled'
  | 'written_off';

export type PaymentLinkStatus =
  | 'uncreated'
  | 'created'
  | 'partially_paid'
  | 'paid'
  | 'expired'
  | 'cancelled';

export type PaymentStatus = 'captured' | 'failed' | 'refunded';

export type TranscriptionStatus = 'recorded' | 'transcribing' | 'completed' | 'failed';

export type ReminderChannel = 'in_app' | 'whatsapp';

export type ReminderStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export type LimitationReviewStatus = 'pending_review' | 'verified' | 'manual_override';

export interface Profile {
  id: string;
  user_id: string;
  display_name: string;
  bar_council_number: string | null;
  office_address: string | null;
  phone: string | null;
  preferred_language: SupportedLanguage;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  owner_id: string;
  name: string;
  phone: string;
  email: string | null;
  case_reference: string | null;
  notes: string | null;
  whatsapp_opt_in: boolean;
  whatsapp_opt_in_at: string | null;
  preferred_language: SupportedLanguage;
  created_at: string;
  updated_at: string;
}

export interface Matter {
  id: string;
  owner_id: string;
  client_id: string;
  matter_number: string;
  title: string;
  court_name: string;
  matter_type: string;
  case_type: string;
  filing_number: string | null;
  cnr_number: string | null;
  status: MatterStatus;
  disposal_date: string | null;
  final_order_summary: string | null;
  next_hearing_date: string | null;
  limitation_date: string | null;
  limitation_rule_ref: string | null;
  limitation_review_status: LimitationReviewStatus;
  fee_structure_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Booking {
  id: string;
  owner_id: string;
  client_id: string;
  matter_id: string | null;
  start_at: string;
  end_at: string | null;
  timezone: string;
  purpose: string;
  status: BookingStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  owner_id: string;
  client_id: string;
  matter_id: string | null;
  invoice_number: string;
  description: string;
  amount_paise: number; // Integer minor currency units (paise)
  due_at: string | null;
  invoice_status: InvoiceStatus;
  razorpay_payment_link_id: string | null;
  razorpay_payment_link_url: string | null;
  payment_link_status: PaymentLinkStatus;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  owner_id: string;
  client_id: string;
  invoice_id: string;
  amount_paise: number;
  razorpay_payment_id: string | null;
  razorpay_payment_link_id: string | null;
  payment_status: PaymentStatus;
  paid_at: string;
  provider_event_id: string; // Database UNIQUE constraint for idempotency
  created_at: string;
}

export interface DiaryEntry {
  id: string;
  owner_id: string;
  client_id: string | null;
  matter_id: string | null;
  audio_storage_path: string | null;
  transcript: string | null;
  transcription_status: TranscriptionStatus;
  transcription_model: string | null;
  language: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRecord {
  id: string;
  owner_id: string;
  client_id: string | null;
  matter_id: string | null;
  template_id: string;
  template_version: string;
  title: string;
  file_storage_path: string;
  form_data_json: Record<string, unknown>;
  statutory_basis: string | null;
  generated_at: string;
  created_at: string;
}

export interface CourtLookup {
  id: string;
  owner_id: string;
  client_id: string | null;
  matter_id: string | null;
  cnr_number: string;
  provider: string;
  result_status: 'pending' | 'success' | 'failed';
  last_result_json: Record<string, unknown> | null;
  checked_at: string;
  error_message: string | null;
}

export interface Reminder {
  id: string;
  owner_id: string;
  booking_id: string | null;
  matter_id: string | null;
  channel: ReminderChannel;
  scheduled_for: string;
  status: ReminderStatus;
  sent_at: string | null;
  attempt_count: number;
  last_error: string | null;
  provider_message_id: string | null;
  template_name: string | null;
  template_language: string | null;
  idempotency_key: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  owner_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata_json: Record<string, unknown>;
  outcome: 'success' | 'failure';
  ip_hash: string | null;
  created_at: string;
}
