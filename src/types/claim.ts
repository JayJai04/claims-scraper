export interface RawClaim {
  claim_id: string;
  policy_number: string | null;
  claimant_name: string | null;
  date_filed: string | null;
  status: string | null;
  amount: number | null;
  description: string | null;
  summary: string | null;
}

export interface RawNote {
  claim_id: string;
  entry_datetime: string | null;
  entered_by: string | null;
  narrative: string | null;
}

export interface RawDocument {
  claim_id: string;
  document_date: string | null;
  category: string | null;
  image_name: string | null;
  pages: number | null;
  download_url: string | null;
  summary: string | null;
}

export interface RawPayment {
  claim_id: string;
  transaction_date: string | null;
  payment_type: string | null;
  payee: string | null;
  status: string | null;
  amount: number | null;
}

export interface RawRequirement {
  claim_id: string;
  created: string | null;
  due_date: string | null;
  requirement: string | null;
  activity_status: string | null;
}

export interface FullClaim {
  claim: RawClaim;
  notes: RawNote[];
  documents: RawDocument[];
  payments: RawPayment[];
  requirements: RawRequirement[];
}

export interface ParserOptions {
  tableSelector?: string;
  detailSelector?: string;
  headerMapping?: Record<string, keyof RawClaim>;
}
