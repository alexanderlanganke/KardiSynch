/**
 * Best-effort lead-model -> connector-type lookup, seeded from public
 * manufacturer documentation (FDA filings, spec sheets, physician's lead
 * manuals — sources cited per rule below). This is a SUGGESTION only: no
 * report ever states a lead's connector type directly (checked all five
 * parsers and real sample PDFs — the only "DF-1" hits in raw files turned
 * out to be false positives from the PDF format header "%PDF-1.4"), so this
 * table exists purely to pre-fill a starting guess for the clinician to
 * confirm. A manually confirmed value (device_types.xml, via
 * DeviceLeadEditor) always wins over this table — see
 * suggestLeadConnector's callers.
 *
 * Scope is intentionally narrow, matching what's clinically flagged on the
 * Patient page: DF-1 shock-coil leads and IS-1 (non-quadripolar) LV leads —
 * both relevant to generator-change planning, since a DF-1 or plain-IS-1
 * system may need an adapter or extra care when paired with a modern
 * DF-4/IS-4-only replacement device. Model families not covered here should
 * NOT be guessed at; leave them unmatched rather than fabricate.
 */

export type LeadConnectorType = 'DF-1' | 'DF-4' | 'IS-1' | 'IS-4';
export type LeadConnectorRole = 'shock' | 'LV';

export interface LeadConnectorSuggestion {
  connector: LeadConnectorType;
  role: LeadConnectorRole;
  family: string;
  source: string;
}

interface ConnectorRule {
  manufacturer: string;
  family: string;
  connector: LeadConnectorType;
  role: LeadConnectorRole;
  match: (model: string) => boolean;
  source: string;
}

const norm = (s: string) => (s || '').trim().toUpperCase();

const RULES: ConnectorRule[] = [
  // --- Medtronic ---
  {
    manufacturer: 'Medtronic', family: 'Sprint Quattro Secure (DF-1)', connector: 'DF-1', role: 'shock',
    match: (m) => { const u = norm(m); return (u.includes('6935') || u.includes('6947')) && !u.includes('6935M') && !u.includes('6947M'); },
    source: 'https://wwwp.medtronic.com/productperformance/model/6935-sprint-quattro-secure-s.html ; FDA recall records for models 6935/6947',
  },
  {
    manufacturer: 'Medtronic', family: 'Sprint Quattro Secure S MRI (DF4)', connector: 'DF-4', role: 'shock',
    match: (m) => { const u = norm(m); return u.includes('6935M') || u.includes('6946M') || u.includes('6947M'); },
    source: 'https://wwwp.medtronic.com/productperformance/model/6946M-sprint-quattro.html',
  },
  {
    manufacturer: 'Medtronic', family: 'Attain bipolar LV lead (IS-1)', connector: 'IS-1', role: 'LV',
    match: (m) => { const u = norm(m); return (u.includes('4193') || u.includes('4194') || u.includes('4195') || u.includes('4196')) && !u.includes('PERFORMA') && !u.includes('STABILITY') && !u.includes('QUAD'); },
    source: 'https://accessgudid.nlm.nih.gov (Attain OTW 4194, Attain StarFix 4195, Attain Ability 4196 — IS-1 bipolar LV leads)',
  },
  // Attain Performa / Attain Stability Quad are IS4 quadripolar — deliberately
  // NOT matched above/below so they never get flagged as the IS-1 case.

  // --- Boston Scientific ---
  {
    manufacturer: 'Boston Scientific', family: 'Endotak Reliance (DF-1)', connector: 'DF-1', role: 'shock',
    match: (m) => { const u = norm(m); return /^0(12[7-9]|13[7-9]|14[3789]|15[3789]|1[78][0-7])/.test(u); },
    source: 'Boston Scientific Endotak Reliance Physician\'s Lead Manual (358079-079)',
  },
  {
    manufacturer: 'Boston Scientific', family: 'Endotak Reliance 4-Site / Reliance 4-Front (DF4)', connector: 'DF-4', role: 'shock',
    match: (m) => { const u = norm(m); return /^0(26[2356]|27[2356]|28[2356]|29[2356]|63[0-9]|65[0-9]|6[67][0-9])/.test(u); },
    source: 'Boston Scientific Reliance 4-Front spec sheet (CRM-...)',
  },
  {
    manufacturer: 'Boston Scientific', family: 'Acuity bipolar LV lead (IS-1)', connector: 'IS-1', role: 'LV',
    match: (m) => { const u = norm(m); return /^45(54|55|91|92|93)/.test(u) && !u.includes('X4'); },
    source: 'Boston Scientific Acuity Spiral Physician\'s Lead Manual (357272-032); CIA Medical catalog listings for 4554/4555',
  },

  // --- Abbott / St. Jude Medical ---
  {
    manufacturer: 'Abbott', family: 'Durata (DF-1)', connector: 'DF-1', role: 'shock',
    match: (m) => { const u = norm(m).replace(/\s/g, ''); return /^71(20|21|22|70|71|72)$/.test(u); },
    source: 'Abbott Durata Lead Model Numbers and Ordering Information (cardiovascular.abbott)',
  },
  {
    manufacturer: 'Abbott', family: 'Durata (DF4)', connector: 'DF-4', role: 'shock',
    match: (m) => { const u = norm(m).replace(/\s/g, ''); return /^71(20|21|22|70|71|72)Q$/.test(u); },
    source: 'Abbott Durata Lead Model Numbers and Ordering Information (cardiovascular.abbott)',
  },
  {
    manufacturer: 'Abbott', family: 'Optisure (DF-1/IS-1)', connector: 'DF-1', role: 'shock',
    match: (m) => { const u = norm(m).replace(/\s/g, ''); return /^(LDA2[23]0|LDP2[23]0)$/.test(u); },
    source: 'Abbott Optisure Post Approval Study protocol (NCT02235545)',
  },
  {
    manufacturer: 'Abbott', family: 'Optisure (DF4)', connector: 'DF-4', role: 'shock',
    match: (m) => { const u = norm(m).replace(/\s/g, ''); return /^(LDA2[123]0Q|LDP2[23]0Q)$/.test(u); },
    source: 'Abbott Optisure Post Approval Study protocol (NCT02235545); LDA210Q-65 product listing (DF4-LLHO)',
  },
  {
    manufacturer: 'Abbott', family: 'QuickFlex bipolar LV lead (IS-1)', connector: 'IS-1', role: 'LV',
    match: (m) => { const u = norm(m); return u.includes('QUICKFLEX') || /^1(056|058|156|158|258)T/.test(u); },
    source: 'St. Jude Medical QuickFlex/QuickFlex μ safety communications (Medscape); QuickFlex Micro Post Approval Study (NCT01179477)',
  },
  // Quartet (Abbott) is IS4 quadripolar — deliberately not matched.

  // --- Biotronik ---
  {
    manufacturer: 'Biotronik', family: 'Plexa DF-1', connector: 'DF-1', role: 'shock',
    match: (m) => { const u = norm(m); return u.includes('PLEXA') && u.includes('DF-1'); },
    source: 'Biotronik Plexa product page (biotronik.com/en-us/products/.../plexa); MAUDE report for Plexa ProMRI DF-1 S DX',
  },
  {
    manufacturer: 'Biotronik', family: 'Plexa DF4', connector: 'DF-4', role: 'shock',
    match: (m) => { const u = norm(m); return u.includes('PLEXA') && !u.includes('DF-1'); },
    source: 'Biotronik Plexa product page (biotronik.com/en-us/products/.../plexa) — S/SD variants without "DF-1" in the name are the DF4 line',
  },
  {
    manufacturer: 'Biotronik', family: 'Corox / Sentus bipolar LV lead (IS-1)', connector: 'IS-1', role: 'LV',
    match: (m) => { const u = norm(m); return (u.includes('COROX') || u.includes('SENTUS')) && !u.includes('QP') && !u.includes('IS4') && !u.includes('IS-4'); },
    source: 'Biotronik CRT Leads catalog (pdf.medicalexpo.com/pdf/biotronik/crt-leads-delivery-system); healthmanagement.org Corox OTW UP listing',
  },
  // Sentus ProMRI QP is IS4 quadripolar ("IS4-LLLL (LV)") — deliberately excluded above.
];

/**
 * Suggests a connector type for a lead model, or null when nothing in the
 * (intentionally narrow) table matches. Never call this to auto-populate
 * persisted data — it's a starting point for a human to confirm.
 */
export function suggestLeadConnector(manufacturer: string | undefined, model: string | undefined): LeadConnectorSuggestion | null {
  if (!manufacturer || !model) return null;
  const mfg = norm(manufacturer);
  for (const rule of RULES) {
    if (norm(rule.manufacturer) !== mfg) continue;
    if (rule.match(model)) {
      return { connector: rule.connector, role: rule.role, family: rule.family, source: rule.source };
    }
  }
  return null;
}

export interface ConnectorFlag {
  connector: LeadConnectorType;
  confirmed: boolean;
}

/**
 * Decides whether a lead should get the prominent DF-1 / IS-1-in-LV-port
 * highlight on the Patient page (#153). `role` (shock vs LV) has no
 * dedicated stored field anywhere — it's only derivable from the lookup
 * table, so it's always taken from there even when the connector itself was
 * manually confirmed via DeviceLeadEditor.
 */
export function getConnectorFlag(lead: { manufacturer?: string; model?: string; connector?: string }): ConnectorFlag | null {
  const confirmedConnector = lead.connector && lead.connector !== 'Unknown' ? (lead.connector as LeadConnectorType) : null;
  const suggestion = suggestLeadConnector(lead.manufacturer, lead.model);
  const connector = confirmedConnector || suggestion?.connector;
  if (!connector) return null;
  const role = suggestion?.role;
  const isFlagged = connector === 'DF-1' || (connector === 'IS-1' && role === 'LV');
  if (!isFlagged) return null;
  return { connector, confirmed: !!confirmedConnector };
}
