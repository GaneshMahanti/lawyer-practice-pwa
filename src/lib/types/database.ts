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
  state_bar_council: string | null;
  chamber_address: string | null;
  city: string | null;
  practice_areas: string[];
  office_address: string | null;
  phone: string | null;
  preferred_language: SupportedLanguage;
  timezone: string;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export type ClientStatus = 'pending' | 'active';

export interface Client {
  id: string;
  owner_id: string;
  name: string;
  phone: string; // Phone No. 1
  phone_2: string | null; // Secondary Phone No.
  email: string | null;
  case_reference: string | null;
  notes: string | null;
  whatsapp_opt_in: boolean;
  whatsapp_opt_in_at: string | null;
  preferred_language: SupportedLanguage;
  status: ClientStatus;
  registration_token: string | null;
  token_expires_at: string | null;
  aadhaar_last4: string | null; // Masked only: e.g. "1234"
  current_address: string | null;
  permanent_address: string | null;
  created_at: string;
  updated_at: string;
}

export type FeeType = 'consultation' | 'legal_notice' | 'case_fee';

export interface ClientFee {
  id: string;
  client_id: string;
  owner_id: string;
  fee_type: FeeType;
  amount: number;
  razorpay_link_id: string | null;
  razorpay_link_url: string | null;
  payment_status: 'unpaid' | 'paid' | 'cancelled';
  created_at: string;
}

export type CaseCategory = 'Civil' | 'Crime' | 'Family' | 'NIA' | string;

export interface Matter {
  id: string;
  owner_id: string;
  client_id: string;
  matter_number: string;
  title: string;
  court_name: string;
  matter_type: string;
  case_type: string;
  category?: CaseCategory;
  state?: string;
  district?: string;
  court_complex?: string;
  case_year?: number | string;
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

export type NoteEntryType = 'voice' | 'text';

export interface DiaryEntry {
  id: string;
  owner_id: string;
  client_id: string | null;
  matter_id: string | null;
  entry_type: NoteEntryType;
  title: string | null;
  content: string | null; // Note text or Whisper transcript
  audio_storage_path: string | null;
  audio_url?: string | null;
  transcript: string | null;
  original_transcript?: string | null;
  edited_transcript?: string | null;
  transcript_edited_at?: string | null;
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
  image_url?: string | null;
  original_text?: string | null; // e.g. Telugu OCR text
  translated_text?: string | null; // e.g. English translation
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

export type PortalInviteStatus =
  | 'pending'
  | 'submitted'
  | 'payment_pending'
  | 'completed'
  | 'revoked'
  | 'expired';

export interface PortalInvite {
  id: string;
  owner_id: string;
  token_hash: string;
  status: PortalInviteStatus;
  advocate_name: string;
  client_name: string | null;
  client_id: string | null;
  fee_snapshot: Array<{ fee_type: string; amount: number; razorpay_link_url: string | null }>;
  expires_at: string;
  revoked_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface PortalSubmission {
  id: string;
  invite_id: string;
  owner_id: string;
  name: string;
  phone_1: string;
  phone_2: string | null;
  aadhaar_last4: string;
  current_address: string;
  permanent_address: string;
  submitted_at: string;
}

export interface ApprovedUser {
  id: string;
  email: string;
  role: 'developer' | 'lawyer';
  name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
