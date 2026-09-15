import Database from 'better-sqlite3';
import type { FullClaim, RawClaim, RawDocument, RawNote, RawPayment, RawRequirement } from '../types/claim.js';
import { hashClaim } from './scraper.js';

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS raw_claims (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id      TEXT NOT NULL,
  policy_number TEXT,
  claimant_name TEXT,
  date_filed    TEXT,
  status        TEXT,
  amount        REAL,
  description   TEXT,
  scraped_at    TEXT DEFAULT (datetime('now')),
  raw_hash      TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS raw_notes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id       TEXT NOT NULL,
  entry_datetime TEXT,
  entered_by     TEXT,
  narrative      TEXT
);
CREATE TABLE IF NOT EXISTS raw_documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id      TEXT NOT NULL,
  document_date TEXT,
  category      TEXT,
  image_name    TEXT,
  pages         INTEGER,
  download_url  TEXT
);
CREATE TABLE IF NOT EXISTS raw_payments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id         TEXT NOT NULL,
  transaction_date TEXT,
  payment_type     TEXT,
  payee            TEXT,
  status           TEXT,
  amount           REAL
);
CREATE TABLE IF NOT EXISTS raw_requirements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id        TEXT NOT NULL,
  created         TEXT,
  due_date        TEXT,
  requirement     TEXT,
  activity_status TEXT
);
`;

export function getDb(path = './claims.db'): Database.Database {
  if (!db) {
    db = new Database(path);
    db.exec(SCHEMA);
  }
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export function insertClaim(claim: RawClaim): { inserted: boolean; id?: number } {
  const database = getDb();
  const rawHash = hashClaim(claim);
  const existing = database.prepare('SELECT id FROM raw_claims WHERE raw_hash = ?').get(rawHash) as
    | { id: number }
    | undefined;
  if (existing) return { inserted: false, id: existing.id };
  const result = database
    .prepare(
      `INSERT INTO raw_claims
        (claim_id, policy_number, claimant_name, date_filed, status, amount, description, raw_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      claim.claim_id,
      claim.policy_number,
      claim.claimant_name,
      claim.date_filed,
      claim.status,
      claim.amount,
      claim.description,
      rawHash,
    );
  return { inserted: true, id: Number(result.lastInsertRowid) };
}

export function insertClaims(claims: RawClaim[]): { inserted: number; skipped: number } {
  let inserted = 0;
  let skipped = 0;
  for (const claim of claims) {
    if (insertClaim(claim).inserted) inserted++;
    else skipped++;
  }
  return { inserted, skipped };
}

export function insertFullClaim(full: FullClaim): void {
  const database = getDb();
  insertClaim(full.claim);
  const claimId = full.claim.claim_id;
  database.prepare('DELETE FROM raw_notes WHERE claim_id = ?').run(claimId);
  database.prepare('DELETE FROM raw_documents WHERE claim_id = ?').run(claimId);
  database.prepare('DELETE FROM raw_payments WHERE claim_id = ?').run(claimId);
  database.prepare('DELETE FROM raw_requirements WHERE claim_id = ?').run(claimId);
  const insertNote = database.prepare(
    'INSERT INTO raw_notes (claim_id, entry_datetime, entered_by, narrative) VALUES (?, ?, ?, ?)',
  );
  for (const n of full.notes) insertNote.run(claimId, n.entry_datetime, n.entered_by, n.narrative);
  const insertDoc = database.prepare(
    'INSERT INTO raw_documents (claim_id, document_date, category, image_name, pages, download_url) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const d of full.documents)
    insertDoc.run(claimId, d.document_date, d.category, d.image_name, d.pages, d.download_url);
  const insertPay = database.prepare(
    'INSERT INTO raw_payments (claim_id, transaction_date, payment_type, payee, status, amount) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const p of full.payments)
    insertPay.run(claimId, p.transaction_date, p.payment_type, p.payee, p.status, p.amount);
  const insertReq = database.prepare(
    'INSERT INTO raw_requirements (claim_id, created, due_date, requirement, activity_status) VALUES (?, ?, ?, ?, ?)',
  );
  for (const r of full.requirements)
    insertReq.run(claimId, r.created, r.due_date, r.requirement, r.activity_status);
}

export function insertFullClaims(fulls: FullClaim[]): { claims: number } {
  for (const f of fulls) insertFullClaim(f);
  return { claims: fulls.length };
}

export type { FullClaim, RawDocument, RawNote, RawPayment, RawRequirement };
