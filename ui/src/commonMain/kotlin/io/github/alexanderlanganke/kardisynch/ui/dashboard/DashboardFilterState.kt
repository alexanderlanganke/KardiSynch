package io.github.alexanderlanganke.kardisynch.ui.dashboard

/** Every dashboard column Electron's `PatientDashboard.tsx` lets you sort by, plus the warning-status urgency rank (issue #197). */
enum class DashboardSortField { NAME, DOB, HOSPITAL_ID, MANUFACTURER, MODEL, LAST_VISIT, WARNING_URGENCY }

/**
 * The Dashboard's whole search/filter/sort UI state, in one value — hosted
 * in [io.github.alexanderlanganke.kardisynch.ui.KardiSynchApp] (above the
 * per-screen `when`) rather than as `remember` state local to
 * `PatientDashboardScreen`, so it survives navigating to Patient Detail and
 * back. Mirrors what Electron persists to `sessionStorage`, minus the
 * literal storage mechanism — Compose state hoisted above the navigation
 * switch achieves the same "survives navigating away and back" behavior
 * without a new persistence layer.
 */
data class DashboardFilterState(
    val query: String = "",
    val filterPanelExpanded: Boolean = false,
    val dobFilter: String = "",
    val patientIdFilter: String = "",
    val hospitalMrnFilter: String = "",
    val manufacturerFilter: String? = null,
    val sortField: DashboardSortField = DashboardSortField.NAME,
    val sortAscending: Boolean = true,
)
