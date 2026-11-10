package io.github.alexanderlanganke.kardisynch.core.aliases

/**
 * Starting lead-connector data (Electron issue #153), sourced from public
 * manufacturer documentation — not this clinic's own data, hence
 * `verified = false` once turned into a [DeviceTypeAlias] by
 * [seedDeviceTypeAliases]. Scope is deliberately narrow: only the two cases
 * the Patient page actually highlights (DF-1 shock-coil leads, and IS-1
 * non-quadripolar LV leads), for the four manufacturers with model numbers
 * concrete enough to seed with confidence. No device-type seed data —
 * each parser already infers device type reasonably well from the raw
 * model string.
 *
 * Model strings are the bare manufacturer model number/name as it typically
 * appears in a parsed report — exact match only, so coverage is necessarily
 * partial. Transcribed mechanically from `deviceTypeAliases.ts`'s
 * `SEED_LEAD_ALIASES` (128 entries, count and content verified against the
 * original 1:1) rather than retyped by hand, to rule out transcription
 * errors in this citation data.
 */
data class SeedLeadAlias(
    val manufacturer: String,
    val model: String,
    val type: String? = null,
    val connector: String,
    val role: String? = null,
    val source: String,
)

val SEED_LEAD_ALIASES: List<SeedLeadAlias> = listOf(
    // --- Medtronic --- https://wwwp.medtronic.com/productperformance/model/6935-sprint-quattro-secure-s.html ; FDA recall records
    SeedLeadAlias(manufacturer = "Medtronic", model = "6935", connector = "DF-1", source = "Medtronic CRHF Product Performance — Sprint Quattro Secure S 6935"),
    SeedLeadAlias(manufacturer = "Medtronic", model = "6947", connector = "DF-1", source = "Medtronic CRHF Product Performance — Sprint Quattro Secure 6947"),
    SeedLeadAlias(manufacturer = "Medtronic", model = "6935M", connector = "DF-4", source = "Medtronic CRHF Product Performance — Sprint Quattro Secure S MRI 6935M (DF4-LLHO)"),
    SeedLeadAlias(manufacturer = "Medtronic", model = "6946M", connector = "DF-4", source = "Medtronic CRHF Product Performance — 6946M Sprint Quattro"),
    SeedLeadAlias(manufacturer = "Medtronic", model = "6947M", connector = "DF-4", source = "Medtronic CRHF Product Performance — Sprint Quattro Secure MRI 6947M (DF4-LLHH)"),
    // Attain bipolar LV leads (IS-1) — https://accessgudid.nlm.nih.gov
    SeedLeadAlias(manufacturer = "Medtronic", model = "4193", type = "Bipolar", connector = "IS-1", role = "LV", source = "AccessGUDID — Attain OTW 4193"),
    SeedLeadAlias(manufacturer = "Medtronic", model = "4194", type = "Bipolar", connector = "IS-1", role = "LV", source = "AccessGUDID — Attain Bipolar OTW 4194"),
    SeedLeadAlias(manufacturer = "Medtronic", model = "4195", type = "Bipolar", connector = "IS-1", role = "LV", source = "FDA P060039 — Attain StarFix 4195"),
    SeedLeadAlias(manufacturer = "Medtronic", model = "4196", type = "Bipolar", connector = "IS-1", role = "LV", source = "Medtronic IFU — Attain Ability 4196 (IS-1I)"),
    // NOTE: Attain Performa / Attain Stability Quad are IS4 quadripolar — deliberately not seeded here.

    // --- Boston Scientific --- Endotak Reliance Physician's Lead Manual (358079-079)
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0127", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0128", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0129", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0137", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0138", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0139", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0143", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0147", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0148", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0149", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0153", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0157", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0158", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0159", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0170", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0171", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0172", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0173", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0174", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0175", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0176", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0177", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0180", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0181", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0182", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0183", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0184", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0185", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0186", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0187", connector = "DF-1", source = "Boston Scientific Endotak Reliance Physician's Lead Manual (358079-079)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0262", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0263", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0265", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0266", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0272", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0273", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0275", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0276", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0282", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0283", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0285", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0286", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0292", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0293", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0295", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0296", connector = "DF-4", source = "Boston Scientific Endotak Reliance 4-Site Physician's Lead Manual"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0636", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0650", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0651", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0652", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0653", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0654", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0655", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0657", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0658", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0662", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0663", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0665", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0672", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0673", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0675", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0676", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0682", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0683", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0685", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0686", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0692", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0693", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0695", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "0696", connector = "DF-4", source = "Boston Scientific Reliance 4-Front spec sheet (CRM-348801)"),
    // Acuity bipolar LV leads (IS-1)
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "4554", type = "Bipolar", connector = "IS-1", role = "LV", source = "Boston Scientific Acuity Spiral Physician's Lead Manual (357272-032); CIA Medical catalog (4554/4555)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "4555", type = "Bipolar", connector = "IS-1", role = "LV", source = "Boston Scientific Acuity Spiral Physician's Lead Manual (357272-032); CIA Medical catalog (4554/4555)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "4591", type = "Bipolar", connector = "IS-1", role = "LV", source = "Boston Scientific Acuity Spiral Physician's Lead Manual (357272-032); CIA Medical catalog (4554/4555)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "4592", type = "Bipolar", connector = "IS-1", role = "LV", source = "Boston Scientific Acuity Spiral Physician's Lead Manual (357272-032); CIA Medical catalog (4554/4555)"),
    SeedLeadAlias(manufacturer = "Boston Scientific", model = "4593", type = "Bipolar", connector = "IS-1", role = "LV", source = "Boston Scientific Acuity Spiral Physician's Lead Manual (357272-032); CIA Medical catalog (4554/4555)"),
    // NOTE: Acuity X4 is IS4 quadripolar — deliberately not seeded here.

    // --- Abbott / St. Jude Medical --- Durata Lead Model Numbers and Ordering Information (cardiovascular.abbott)
    SeedLeadAlias(manufacturer = "Abbott", model = "7120", connector = "DF-1", source = "Abbott Durata Lead Model Numbers and Ordering Information"),
    SeedLeadAlias(manufacturer = "Abbott", model = "7121", connector = "DF-1", source = "Abbott Durata Lead Model Numbers and Ordering Information"),
    SeedLeadAlias(manufacturer = "Abbott", model = "7122", connector = "DF-1", source = "Abbott Durata Lead Model Numbers and Ordering Information"),
    SeedLeadAlias(manufacturer = "Abbott", model = "7170", connector = "DF-1", source = "Abbott Durata Lead Model Numbers and Ordering Information"),
    SeedLeadAlias(manufacturer = "Abbott", model = "7171", connector = "DF-1", source = "Abbott Durata Lead Model Numbers and Ordering Information"),
    SeedLeadAlias(manufacturer = "Abbott", model = "7172", connector = "DF-1", source = "Abbott Durata Lead Model Numbers and Ordering Information"),
    SeedLeadAlias(manufacturer = "Abbott", model = "7120Q", connector = "DF-4", source = "Abbott Durata Lead Model Numbers and Ordering Information"),
    SeedLeadAlias(manufacturer = "Abbott", model = "7121Q", connector = "DF-4", source = "Abbott Durata Lead Model Numbers and Ordering Information"),
    SeedLeadAlias(manufacturer = "Abbott", model = "7122Q", connector = "DF-4", source = "Abbott Durata Lead Model Numbers and Ordering Information"),
    SeedLeadAlias(manufacturer = "Abbott", model = "7170Q", connector = "DF-4", source = "Abbott Durata Lead Model Numbers and Ordering Information"),
    SeedLeadAlias(manufacturer = "Abbott", model = "7171Q", connector = "DF-4", source = "Abbott Durata Lead Model Numbers and Ordering Information"),
    SeedLeadAlias(manufacturer = "Abbott", model = "7172Q", connector = "DF-4", source = "Abbott Durata Lead Model Numbers and Ordering Information"),
    SeedLeadAlias(manufacturer = "Abbott", model = "LDA220", connector = "DF-1", source = "Abbott Optisure Post Approval Study protocol (NCT02235545)"),
    SeedLeadAlias(manufacturer = "Abbott", model = "LDA230", connector = "DF-1", source = "Abbott Optisure Post Approval Study protocol (NCT02235545)"),
    SeedLeadAlias(manufacturer = "Abbott", model = "LDP220", connector = "DF-1", source = "Abbott Optisure Post Approval Study protocol (NCT02235545)"),
    SeedLeadAlias(manufacturer = "Abbott", model = "LDP230", connector = "DF-1", source = "Abbott Optisure Post Approval Study protocol (NCT02235545)"),
    SeedLeadAlias(manufacturer = "Abbott", model = "LDA210Q", connector = "DF-4", source = "Abbott Optisure Post Approval Study protocol (NCT02235545); LDA210Q-65 listing (DF4-LLHO)"),
    SeedLeadAlias(manufacturer = "Abbott", model = "LDA220Q", connector = "DF-4", source = "Abbott Optisure Post Approval Study protocol (NCT02235545); LDA210Q-65 listing (DF4-LLHO)"),
    SeedLeadAlias(manufacturer = "Abbott", model = "LDA230Q", connector = "DF-4", source = "Abbott Optisure Post Approval Study protocol (NCT02235545); LDA210Q-65 listing (DF4-LLHO)"),
    SeedLeadAlias(manufacturer = "Abbott", model = "LDP220Q", connector = "DF-4", source = "Abbott Optisure Post Approval Study protocol (NCT02235545); LDA210Q-65 listing (DF4-LLHO)"),
    SeedLeadAlias(manufacturer = "Abbott", model = "LDP230Q", connector = "DF-4", source = "Abbott Optisure Post Approval Study protocol (NCT02235545); LDA210Q-65 listing (DF4-LLHO)"),
    // QuickFlex bipolar LV leads (IS-1)
    SeedLeadAlias(manufacturer = "Abbott", model = "1056T", type = "Bipolar", connector = "IS-1", role = "LV", source = "St. Jude Medical QuickFlex/QuickFlex μ safety communications; QuickFlex Micro Post Approval Study (NCT01179477)"),
    SeedLeadAlias(manufacturer = "Abbott", model = "1058T", type = "Bipolar", connector = "IS-1", role = "LV", source = "St. Jude Medical QuickFlex/QuickFlex μ safety communications; QuickFlex Micro Post Approval Study (NCT01179477)"),
    SeedLeadAlias(manufacturer = "Abbott", model = "1156T", type = "Bipolar", connector = "IS-1", role = "LV", source = "St. Jude Medical QuickFlex/QuickFlex μ safety communications; QuickFlex Micro Post Approval Study (NCT01179477)"),
    SeedLeadAlias(manufacturer = "Abbott", model = "1158T", type = "Bipolar", connector = "IS-1", role = "LV", source = "St. Jude Medical QuickFlex/QuickFlex μ safety communications; QuickFlex Micro Post Approval Study (NCT01179477)"),
    SeedLeadAlias(manufacturer = "Abbott", model = "1258T", type = "Bipolar", connector = "IS-1", role = "LV", source = "St. Jude Medical QuickFlex/QuickFlex μ safety communications; QuickFlex Micro Post Approval Study (NCT01179477)"),
    // NOTE: Quartet is IS4 quadripolar — deliberately not seeded here.

    // --- Biotronik --- Plexa product page (biotronik.com); MAUDE report for Plexa ProMRI DF-1 S DX
    // Lower confidence than the numeric-model entries above — Biotronik model
    // strings vary more in exact formatting, so these may match less reliably.
    SeedLeadAlias(manufacturer = "Biotronik", model = "Plexa ProMRI DF-1 S 65", connector = "DF-1", source = "Biotronik Plexa product page"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Plexa ProMRI DF-1 S 75", connector = "DF-1", source = "Biotronik Plexa product page"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Plexa ProMRI DF-1 SD 65/16", connector = "DF-1", source = "Biotronik Plexa product page"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Plexa ProMRI DF-1 SD 65/18", connector = "DF-1", source = "Biotronik Plexa product page"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Plexa ProMRI DF-1 SD 75/18", connector = "DF-1", source = "Biotronik Plexa product page"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Plexa ProMRI DF-1 S DX 65/15", connector = "DF-1", source = "MAUDE adverse event report — Plexa ProMRI DF-1 S DX 65/15"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Plexa ProMRI DF-1 S DX 65/17", connector = "DF-1", source = "Biotronik Plexa product page"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Plexa S 60", connector = "DF-4", source = "Biotronik Plexa product page"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Plexa SD 60/16", connector = "DF-4", source = "Biotronik Plexa product page"),
    // Corox/Sentus bipolar LV leads (IS-1)
    SeedLeadAlias(manufacturer = "Biotronik", model = "Corox OTW BP 75", type = "Bipolar", connector = "IS-1", role = "LV", source = "Biotronik CRT Leads catalog"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Corox OTW BP 85", type = "Bipolar", connector = "IS-1", role = "LV", source = "Biotronik CRT Leads catalog"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Corox OTW-S BP 75", type = "Bipolar", connector = "IS-1", role = "LV", source = "Biotronik CRT Leads catalog"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Corox OTW-S BP 85", type = "Bipolar", connector = "IS-1", role = "LV", source = "Biotronik CRT Leads catalog"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Corox OTW-L BP 75", type = "Bipolar", connector = "IS-1", role = "LV", source = "Biotronik CRT Leads catalog"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Corox OTW-L BP 85", type = "Bipolar", connector = "IS-1", role = "LV", source = "Biotronik CRT Leads catalog"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Sentus OTW BP L 75", type = "Bipolar", connector = "IS-1", role = "LV", source = "Biotronik CRT Leads catalog"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Sentus OTW BP L 85", type = "Bipolar", connector = "IS-1", role = "LV", source = "Biotronik CRT Leads catalog"),
    SeedLeadAlias(manufacturer = "Biotronik", model = "Sentus OTW BP L 95", type = "Bipolar", connector = "IS-1", role = "LV", source = "Biotronik CRT Leads catalog"),
    // NOTE: Sentus ProMRI QP ("IS4-LLLL (LV)") is IS4 quadripolar — deliberately not seeded here.
)

/**
 * Idempotent, additive-only: returns each seed row that has no existing
 * entry (seeded or clinician-confirmed) for the same `(kind, manufacturer,
 * model)` key — never touches a key that's already present, so a
 * clinician's manual correction (or a previous run of this same function)
 * is never overwritten. Safe to call on every app startup; the caller
 * appends the result to the existing list and persists it.
 */
fun seedDeviceTypeAliases(existing: List<DeviceTypeAlias>, createdAt: String): List<DeviceTypeAlias> {
    val existingKeys = existing.map { "${it.kind}|${normalizeAliasKey(it.manufacturer, it.model)}" }.toSet()
    val seenSeedKeys = mutableSetOf<String>()
    val toAdd = mutableListOf<DeviceTypeAlias>()
    for (seed in SEED_LEAD_ALIASES) {
        val key = "${AliasKind.LEAD}|${normalizeAliasKey(seed.manufacturer, seed.model)}"
        if (key in existingKeys) continue
        if (!seenSeedKeys.add(key)) continue // duplicate within SEED_LEAD_ALIASES — keep the first
        toAdd += DeviceTypeAlias(
            manufacturer = seed.manufacturer,
            model = seed.model,
            type = seed.type.orEmpty(),
            createdAt = createdAt,
            kind = AliasKind.LEAD,
            connector = seed.connector,
            role = seed.role,
            verified = false,
        )
    }
    return toAdd
}
