package io.github.alexanderlanganke.kardisynch.ui

import io.github.alexanderlanganke.kardisynch.core.i18n.tr
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Newspaper
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Text
import androidx.compose.runtime.key
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.ui.inbox.BundleReviewScreen
import io.github.alexanderlanganke.kardisynch.ui.inbox.InboxScreen
import io.github.alexanderlanganke.kardisynch.ui.inbox.IntakeSource
import io.github.alexanderlanganke.kardisynch.ui.nav.AppBackHandler
import io.github.alexanderlanganke.kardisynch.ui.theme.KardiSynchTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.Devices
import io.github.alexanderlanganke.kardisynch.data.db.Leads
import io.github.alexanderlanganke.kardisynch.data.db.Reports
import io.github.alexanderlanganke.kardisynch.ui.aliases.AliasSettingsScreen
import io.github.alexanderlanganke.kardisynch.ui.dashboard.DashboardFilterState
import io.github.alexanderlanganke.kardisynch.ui.dashboard.PatientDashboardScreen
import io.github.alexanderlanganke.kardisynch.ui.detail.PatientDetailScreen
import io.github.alexanderlanganke.kardisynch.ui.duplicates.DuplicatesScreen
import io.github.alexanderlanganke.kardisynch.ui.importhistory.ImportHistoryScreen
import io.github.alexanderlanganke.kardisynch.ui.news.DeviceNewsScreen
import io.github.alexanderlanganke.kardisynch.ui.notifications.ActivityTask
import io.github.alexanderlanganke.kardisynch.ui.notifications.NotificationCenterState
import io.github.alexanderlanganke.kardisynch.ui.onboarding.OnboardingScreen
import io.github.alexanderlanganke.kardisynch.ui.orphans.OrphanedVisitsScreen
import io.github.alexanderlanganke.kardisynch.ui.pendingsort.PendingSortScreen
import io.github.alexanderlanganke.kardisynch.ui.settings.SettingsScreen
import io.github.alexanderlanganke.kardisynch.ui.theme.ThemeMode
import io.github.alexanderlanganke.kardisynch.core.aliases.AliasKind
import io.github.alexanderlanganke.kardisynch.core.aliases.DeviceTypeAlias
import io.github.alexanderlanganke.kardisynch.core.aliases.LeadAliasAttrs
import io.github.alexanderlanganke.kardisynch.core.datastore.DataEntry
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.LeadData
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport
import io.github.alexanderlanganke.kardisynch.core.news.CachedDeviceNewsService

private sealed interface Screen {
    data object Dashboard : Screen
    data class Detail(val patientId: String) : Screen
    data class Visit(val patientId: String, val reportId: String) : Screen
    data object Settings : Screen
    data object Inbox : Screen
    data class BundleReview(val key: String) : Screen
    data object PendingSort : Screen
    data object Duplicates : Screen
    data object DeviceNews : Screen
    data object Portals : Screen
    data object OrphanedVisits : Screen
    data class ImportHistory(val from: Screen) : Screen
    data object AliasSettings : Screen
}

/**
 * Where system back (Android back, Desktop Escape) goes from each screen: the
 * same destination the on-screen back control uses, null at the root. Kept next
 * to [Screen] so the two cannot drift apart.
 */
private fun Screen.backTarget(): Screen? = when (this) {
    Screen.Dashboard -> null
    is Screen.Detail, Screen.Settings, Screen.Inbox, Screen.DeviceNews, Screen.Portals -> Screen.Dashboard
    is Screen.Visit -> Screen.Detail(patientId)
    is Screen.BundleReview, Screen.PendingSort -> Screen.Inbox
    Screen.Duplicates, Screen.OrphanedVisits, Screen.AliasSettings -> Screen.Settings
    is Screen.ImportHistory -> from
}

private enum class Destination(val label: String, val icon: ImageVector) {
    PATIENTS("Patients", Icons.Filled.People),
    INBOX("Inbox", Icons.Filled.Inbox),
    NEWS("Device news", Icons.Filled.Newspaper),
    PORTALS("Web portals", Icons.Filled.Public),
    SETTINGS("Settings", Icons.Filled.Settings),
}

private fun Screen.destination(): Destination? = when (this) {
    Screen.Dashboard -> Destination.PATIENTS
    Screen.Inbox -> Destination.INBOX
    Screen.DeviceNews -> Destination.NEWS
    Screen.Portals -> Destination.PORTALS
    Screen.Settings -> Destination.SETTINGS
    else -> null
}

private val WIDE_BREAKPOINT = 840.dp
private val LIST_PANE_WIDTH = 420.dp
private val RAIL_WIDTH = 80.dp
private val BAR_HEIGHT = 80.dp

/**
 * Top-level navigation shell, shared across every KMP target — Phase 1
 * read-only scope (Dashboard/Detail/Settings). Each app shell (desktopApp,
 * androidApp) supplies the repository and the settings-screen callbacks
 * (data-root picking is inherently platform-specific, see [SettingsScreen]'s
 * doc comment).
 *
 * Theming follows the system light/dark setting (issue #196) via Material3's
 * built-in [isSystemInDarkTheme] by default, with an optional manual
 * [themeMode] override (parity plan Phase 3) — mirrors Electron's
 * `ThemeProvider.tsx`. [onThemeModeChange] is null-gated like every other
 * platform-bridged capability here; the platform layer owns persisting the
 * choice (there's no settings-persistence primitive in commonMain).
 *
 * [appVersion]/[notificationMessage] surface two more app-shell pieces
 * (issue #196): a version line in Settings' new "About" section, and a
 * transient [SnackbarHost] for whatever the platform layer's watchers
 * report (import/reparse/merge results, etc.) — mirrors Electron's
 * `sendNotification` toast. Every distinct [notificationMessage] is also
 * kept in a [NotificationCenterState] surfaced via [NotificationCenterBell]
 * on the Dashboard's top bar (parity plan Phase 13) — see that composable's
 * doc comment for how it and its Activity/Sorting tabs are scoped down
 * from Electron's `NotificationCenter.tsx`.
 */
@Composable
fun KardiSynchApp(
    repository: KardiSynchRepository,
    dataRootLabel: String?,
    isReindexing: Boolean,
    lastReindexSummary: String?,
    onPickDataRoot: () -> Unit,
    onReindex: () -> Unit,
    onClearLocalIndex: () -> Unit,
    importDirLabel: String? = null,
    onPickImportDir: (() -> Unit)? = null,
    onReprocessUnmatched: (() -> Unit)? = null,
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)? = null,
    usbSourceDirs: List<String> = emptyList(),
    onAddUsbSourceDir: (() -> Unit)? = null,
    onRemoveUsbSourceDir: ((String) -> Unit)? = null,
    usbTargetDirLabel: String? = null,
    onPickUsbTargetDir: (() -> Unit)? = null,
    isReparsing: Boolean = false,
    onReparseAll: (() -> Unit)? = null,
    pendingSortCount: Int = 0,
    pendingSortRefreshKey: Any = Unit,
    onApprovePendingSort: ((taskId: String, patientId: String) -> Unit)? = null,
    onDismissPendingSort: ((taskId: String) -> Unit)? = null,
    onCreateNewPatientFromPendingSort: ((taskId: String, firstName: String, lastName: String, dob: String, hospitalPatientId: String?) -> Unit)? = null,
    onManualAssignPendingSort: ((taskId: String, patientId: String, manufacturer: String, deviceType: String, deviceModel: String, deviceSerial: String, interrogationDate: String) -> Unit)? = null,
    onReadPendingSortFileBytes: (suspend (stagedFilePath: String) -> ByteArray?)? = null,
    onReadPendingSortFileText: (suspend (stagedFilePath: String) -> String?)? = null,
    onOpenUrl: ((String) -> Unit)? = null,
    onEditPatientInfo: ((patientId: String, firstName: String, lastName: String, dob: String, hospitalPatientId: String?) -> Unit)? = null,
    onMoveReport: ((reportId: String, fromPatientId: String, toPatientId: String) -> Unit)? = null,
    duplicatesRefreshKey: Any = Unit,
    onMergeDuplicates: ((keeperId: String, loserIds: List<String>) -> Unit)? = null,
    appVersion: String? = null,
    update: io.github.alexanderlanganke.kardisynch.ui.update.UpdateController? = null,
    /** Web portals and the downloads folder watcher; null hides the download handling (the portal links stay). */
    portals: io.github.alexanderlanganke.kardisynch.ui.webpanel.PortalsController? = null,
    notificationMessage: String? = null,
    notificationKey: Any? = null,
    deviceNewsService: CachedDeviceNewsService? = null,
    showOnboarding: Boolean = false,
    onOnboardingFinish: (() -> Unit)? = null,
    onOnboardingSkip: (() -> Unit)? = null,
    onOpenPatientFolder: ((patientId: String) -> Unit)? = null,
    todayIso: String? = null,
    onFindOrphanedVisits: (suspend () -> List<KardiSynchRepository.OrphanVisit>)? = null,
    onMoveOrphanedVisits: (suspend (List<String>) -> KardiSynchRepository.OrphanMoveResult)? = null,
    onListDeviceTypeAliases: (suspend () -> List<DeviceTypeAlias>)? = null,
    onUpsertDeviceTypeAlias: (suspend (manufacturer: String, model: String, type: String) -> Result<Unit>)? = null,
    onUpsertLeadTypeAlias: (suspend (manufacturer: String, model: String, attrs: LeadAliasAttrs) -> Result<Unit>)? = null,
    onDeleteDeviceTypeAlias: (suspend (manufacturer: String, model: String, kind: AliasKind) -> Result<Unit>)? = null,
    onDeleteReport: ((reportId: String) -> Unit)? = null,
    isDeduping: Boolean = false,
    onDedupReports: (() -> Unit)? = null,
    themeMode: ThemeMode = ThemeMode.SYSTEM,
    onThemeModeChange: ((ThemeMode) -> Unit)? = null,
    /** The chosen language, or null to follow the system (German on a German system, otherwise English). */
    language: io.github.alexanderlanganke.kardisynch.core.i18n.Lang? = null,
    onLanguageChange: ((io.github.alexanderlanganke.kardisynch.core.i18n.Lang?) -> Unit)? = null,
    onEditReportDevicesAndLeads: ((reportId: String, patientId: String, manufacturer: String, device: DeviceInfo, leads: List<LeadData>) -> Unit)? = null,
    onRescanVisit: (suspend (patientId: String, reportId: String) -> UnifiedReport?)? = null,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)? = null,
    onReadVisitFileBytes: (suspend (fileHandle: String) -> ByteArray?)? = null,
    onReadVisitFileText: (suspend (fileHandle: String) -> String?)? = null,
    onGetMergedAdditionalFields: (suspend (patientId: String) -> Map<String, KardiSynchRepository.MergedAdditionalField>)? = null,
    intakeSources: List<IntakeSource> = emptyList(),
    onResolveBundle: ((bundleId: String, patientId: String) -> Unit)? = null,
    onDismissBundle: ((bundleId: String) -> Unit)? = null,
    onResolveFiles: ((assignments: List<Pair<String, String>>) -> Unit)? = null,
) {
    var screen by remember { mutableStateOf<Screen>(Screen.Dashboard) }
    var dashboardFilterState by remember { mutableStateOf(DashboardFilterState()) }
    val snackbarHostState = remember { SnackbarHostState() }
    val notificationCenterState = remember { NotificationCenterState() }
    val activityTasks = buildList {
        if (isReindexing) add(ActivityTask("reindex", "Reindexing"))
        if (isReparsing) add(ActivityTask("reparse", "Reparsing all visits"))
        if (isDeduping) add(ActivityTask("dedup", "Deduplicating reports"))
    }

    LaunchedEffect(notificationKey) {
        notificationMessage?.let {
            snackbarHostState.showSnackbar(it)
            notificationCenterState.push(it)
        }
    }

    val useDarkTheme = when (themeMode) {
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
    }

    val effectiveLang = language ?: io.github.alexanderlanganke.kardisynch.core.i18n.defaultLangFor(androidx.compose.ui.text.intl.Locale.current.language)
    io.github.alexanderlanganke.kardisynch.core.i18n.I18n.lang = effectiveLang
    androidx.compose.runtime.key(effectiveLang) {
    KardiSynchTheme(darkTheme = useDarkTheme) {
        if (showOnboarding && onOnboardingFinish != null && onOnboardingSkip != null) {
            OnboardingScreen(
                dataRootLabel = dataRootLabel,
                importDirLabel = importDirLabel,
                onPickDataRoot = onPickDataRoot,
                onPickImportDir = { onPickImportDir?.invoke() },
                onFinish = onOnboardingFinish,
                onSkip = onOnboardingSkip,
            )
            return@KardiSynchTheme
        }

        val back = screen.backTarget()
        AppBackHandler(enabled = back != null) { back?.let { screen = it } }
        val focus = remember { FocusRequester() }
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
        val sortingAvailable = onApprovePendingSort != null || onDismissPendingSort != null
        val inboxBadge = pendingSortCount + notificationCenterState.notifications.count { !it.read }

        Scaffold(
            snackbarHost = { SnackbarHost(snackbarHostState) },
            modifier = Modifier
                .focusRequester(focus)
                .focusable()
                .onPreviewKeyEvent { event ->
                    // Escape is desktop's "back": exactly one level, like Android's back gesture.
                    if (event.type == KeyEventType.KeyDown && event.key == Key.Escape && back != null) {
                        screen = back
                        true
                    } else {
                        false
                    }
                },
        ) { snackbarPadding ->
            Column(Modifier.fillMaxSize().padding(snackbarPadding)) {
            io.github.alexanderlanganke.kardisynch.ui.update.UpdateBanner(update)
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                val wide = maxWidth >= WIDE_BREAKPOINT
                val current = screen
                val destination = current.destination()
                // Navigation chrome belongs to the root destinations, and to an open patient on wide
                // screens (where the patient fills the right-hand pane next to the list).
                val showChrome = destination != null || (wide && (current is Screen.Detail || current is Screen.Visit))
                val activeDestination = destination ?: Destination.PATIENTS
                val destinations = Destination.entries.filter { (it != Destination.NEWS || deviceNewsService != null) && (it != Destination.PORTALS || onOpenUrl != null) }
                val contentWidth = if (wide && showChrome) maxWidth - RAIL_WIDTH else maxWidth
                val contentHeight = if (!wide && showChrome) maxHeight - BAR_HEIGHT else maxHeight

                fun go(d: Destination) {
                    screen = when (d) {
                        Destination.PATIENTS -> Screen.Dashboard
                        Destination.INBOX -> Screen.Inbox
                        Destination.NEWS -> Screen.DeviceNews
                        Destination.PORTALS -> Screen.Portals
                        Destination.SETTINGS -> Screen.Settings
                    }
                }

                @Composable
                fun Content(width: androidx.compose.ui.unit.Dp) {
                    Box(Modifier.width(width).height(contentHeight)) {
                        ScreenContent(
                            current = current, wide = wide, width = width,
                            setScreen = { screen = it },
                            repository = repository, dataRootLabel = dataRootLabel, isReindexing = isReindexing, lastReindexSummary = lastReindexSummary,
                            onPickDataRoot = onPickDataRoot, onReindex = onReindex, onClearLocalIndex = onClearLocalIndex,
                            importDirLabel = importDirLabel, onPickImportDir = onPickImportDir, onReprocessUnmatched = onReprocessUnmatched,
                            onExportQr = onExportQr, usbSourceDirs = usbSourceDirs, onAddUsbSourceDir = onAddUsbSourceDir,
                            onRemoveUsbSourceDir = onRemoveUsbSourceDir, usbTargetDirLabel = usbTargetDirLabel, onPickUsbTargetDir = onPickUsbTargetDir,
                            isReparsing = isReparsing, onReparseAll = onReparseAll, pendingSortCount = pendingSortCount, pendingSortRefreshKey = pendingSortRefreshKey,
                            onApprovePendingSort = onApprovePendingSort, onDismissPendingSort = onDismissPendingSort,
                            onCreateNewPatientFromPendingSort = onCreateNewPatientFromPendingSort, onManualAssignPendingSort = onManualAssignPendingSort,
                            onReadPendingSortFileBytes = onReadPendingSortFileBytes, onReadPendingSortFileText = onReadPendingSortFileText,
                            onOpenUrl = onOpenUrl, onEditPatientInfo = onEditPatientInfo, onMoveReport = onMoveReport,
                            duplicatesRefreshKey = duplicatesRefreshKey, onMergeDuplicates = onMergeDuplicates, appVersion = appVersion, update = update,
                            deviceNewsService = deviceNewsService, onOpenPatientFolder = onOpenPatientFolder, todayIso = todayIso,
                            onFindOrphanedVisits = onFindOrphanedVisits, onMoveOrphanedVisits = onMoveOrphanedVisits,
                            onListDeviceTypeAliases = onListDeviceTypeAliases, onUpsertDeviceTypeAlias = onUpsertDeviceTypeAlias,
                            onUpsertLeadTypeAlias = onUpsertLeadTypeAlias, onDeleteDeviceTypeAlias = onDeleteDeviceTypeAlias,
                            onDeleteReport = onDeleteReport, isDeduping = isDeduping, onDedupReports = onDedupReports,
                            themeMode = themeMode, onThemeModeChange = onThemeModeChange, language = language, onLanguageChange = onLanguageChange, portals = portals,
                            onEditReportDevicesAndLeads = onEditReportDevicesAndLeads, onRescanVisit = onRescanVisit,
                            onGetVisitFiles = onGetVisitFiles, onReadVisitFileBytes = onReadVisitFileBytes, onReadVisitFileText = onReadVisitFileText,
                            onGetMergedAdditionalFields = onGetMergedAdditionalFields,
                            dashboardFilterState = dashboardFilterState, onDashboardFilterStateChange = { dashboardFilterState = it },
                            notificationCenterState = notificationCenterState, activityTasks = activityTasks,
                            intakeSources = intakeSources, onResolveBundle = onResolveBundle, onDismissBundle = onDismissBundle, onResolveFiles = onResolveFiles,
                            sortingAvailable = sortingAvailable,
                        )
                    }
                }

                if (wide) {
                    Row(Modifier.fillMaxSize()) {
                        if (showChrome) {
                            NavigationRail(Modifier.fillMaxHeight().width(RAIL_WIDTH)) {
                                destinations.forEach { d ->
                                    NavigationRailItem(
                                        selected = d == activeDestination, onClick = { go(d) },
                                        icon = { NavIcon(d, if (d == Destination.INBOX) inboxBadge else if (d == Destination.PORTALS) (portals?.downloads?.size ?: 0) else 0) },
                                        label = { Text(tr(d.label), maxLines = 1, softWrap = false, style = androidx.compose.material3.MaterialTheme.typography.labelSmall) }, alwaysShowLabel = true,
                                    )
                                }
                            }
                        }
                        Content(contentWidth)
                    }
                } else {
                    Column(Modifier.fillMaxSize()) {
                        Content(contentWidth)
                        if (showChrome) {
                            NavigationBar(Modifier.height(BAR_HEIGHT)) {
                                destinations.forEach { d ->
                                    NavigationBarItem(
                                        selected = d == activeDestination, onClick = { go(d) },
                                        icon = { NavIcon(d, if (d == Destination.INBOX) inboxBadge else if (d == Destination.PORTALS) (portals?.downloads?.size ?: 0) else 0) },
                                        label = { Text(tr(d.label)) },
                                    )
                                }
                            }
                        }
                    }
                }
            }
            }
        }
    }
    }
}

@Composable
private fun NavIcon(d: Destination, badge: Int) {
    if (badge > 0) {
        BadgedBox(badge = { Badge { Text(if (badge > 99) "99+" else "$badge") } }) { Icon(d.icon, contentDescription = null) }
    } else {
        Icon(d.icon, contentDescription = null)
    }
}

@Composable
private fun ScreenContent(
    current: Screen,
    wide: Boolean,
    width: androidx.compose.ui.unit.Dp,
    setScreen: (Screen) -> Unit,
    repository: KardiSynchRepository,
    dataRootLabel: String?,
    isReindexing: Boolean,
    lastReindexSummary: String?,
    onPickDataRoot: () -> Unit,
    onReindex: () -> Unit,
    onClearLocalIndex: () -> Unit,
    importDirLabel: String?,
    onPickImportDir: (() -> Unit)?,
    onReprocessUnmatched: (() -> Unit)?,
    onExportQr: ((Reports, List<Devices>, List<Leads>) -> Unit)?,
    usbSourceDirs: List<String>,
    onAddUsbSourceDir: (() -> Unit)?,
    onRemoveUsbSourceDir: ((String) -> Unit)?,
    usbTargetDirLabel: String?,
    onPickUsbTargetDir: (() -> Unit)?,
    isReparsing: Boolean,
    onReparseAll: (() -> Unit)?,
    pendingSortCount: Int,
    pendingSortRefreshKey: Any,
    onApprovePendingSort: ((taskId: String, patientId: String) -> Unit)?,
    onDismissPendingSort: ((taskId: String) -> Unit)?,
    onCreateNewPatientFromPendingSort: ((taskId: String, firstName: String, lastName: String, dob: String, hospitalPatientId: String?) -> Unit)?,
    onManualAssignPendingSort: ((taskId: String, patientId: String, manufacturer: String, deviceType: String, deviceModel: String, deviceSerial: String, interrogationDate: String) -> Unit)?,
    onReadPendingSortFileBytes: (suspend (stagedFilePath: String) -> ByteArray?)?,
    onReadPendingSortFileText: (suspend (stagedFilePath: String) -> String?)?,
    onOpenUrl: ((String) -> Unit)?,
    onEditPatientInfo: ((patientId: String, firstName: String, lastName: String, dob: String, hospitalPatientId: String?) -> Unit)?,
    onMoveReport: ((reportId: String, fromPatientId: String, toPatientId: String) -> Unit)?,
    duplicatesRefreshKey: Any,
    onMergeDuplicates: ((keeperId: String, loserIds: List<String>) -> Unit)?,
    appVersion: String?,
    portals: io.github.alexanderlanganke.kardisynch.ui.webpanel.PortalsController?,
    language: io.github.alexanderlanganke.kardisynch.core.i18n.Lang?,
    onLanguageChange: ((io.github.alexanderlanganke.kardisynch.core.i18n.Lang?) -> Unit)?,
    update: io.github.alexanderlanganke.kardisynch.ui.update.UpdateController?,
    deviceNewsService: CachedDeviceNewsService?,
    onOpenPatientFolder: ((patientId: String) -> Unit)?,
    todayIso: String?,
    onFindOrphanedVisits: (suspend () -> List<KardiSynchRepository.OrphanVisit>)?,
    onMoveOrphanedVisits: (suspend (List<String>) -> KardiSynchRepository.OrphanMoveResult)?,
    onListDeviceTypeAliases: (suspend () -> List<DeviceTypeAlias>)?,
    onUpsertDeviceTypeAlias: (suspend (manufacturer: String, model: String, type: String) -> Result<Unit>)?,
    onUpsertLeadTypeAlias: (suspend (manufacturer: String, model: String, attrs: LeadAliasAttrs) -> Result<Unit>)?,
    onDeleteDeviceTypeAlias: (suspend (manufacturer: String, model: String, kind: AliasKind) -> Result<Unit>)?,
    onDeleteReport: ((reportId: String) -> Unit)?,
    isDeduping: Boolean,
    onDedupReports: (() -> Unit)?,
    themeMode: ThemeMode,
    onThemeModeChange: ((ThemeMode) -> Unit)?,
    onEditReportDevicesAndLeads: ((reportId: String, patientId: String, manufacturer: String, device: DeviceInfo, leads: List<LeadData>) -> Unit)?,
    onRescanVisit: (suspend (patientId: String, reportId: String) -> UnifiedReport?)?,
    onGetVisitFiles: (suspend (patientId: String, reportId: String) -> List<DataEntry>)?,
    onReadVisitFileBytes: (suspend (fileHandle: String) -> ByteArray?)?,
    onReadVisitFileText: (suspend (fileHandle: String) -> String?)?,
    onGetMergedAdditionalFields: (suspend (patientId: String) -> Map<String, KardiSynchRepository.MergedAdditionalField>)?,
    dashboardFilterState: DashboardFilterState,
    onDashboardFilterStateChange: (DashboardFilterState) -> Unit,
    notificationCenterState: NotificationCenterState,
    activityTasks: List<ActivityTask>,
    intakeSources: List<IntakeSource>,
    onResolveBundle: ((bundleId: String, patientId: String) -> Unit)?,
    onDismissBundle: ((bundleId: String) -> Unit)?,
    onResolveFiles: ((assignments: List<Pair<String, String>>) -> Unit)?,
    sortingAvailable: Boolean,
) {
    @Composable
    fun Dashboard(selected: String?, modifier: Modifier = Modifier) = Box(modifier) {
        PatientDashboardScreen(
            repository = repository,
            onOpenPatient = { setScreen(Screen.Detail(it)) },
            filterState = dashboardFilterState,
            onFilterStateChange = onDashboardFilterStateChange,
            selectedPatientId = selected,
            onOpenPatientFolder = onOpenPatientFolder,
            onOpenUrl = onOpenUrl,
            todayIso = todayIso,
            onExportQr = onExportQr,
        )
    }

    @Composable
    fun Detail(patientId: String, onBack: (() -> Unit)?, modifier: Modifier = Modifier, visitId: String? = null) = Box(modifier) {
        key(patientId) {
            PatientDetailScreen(
                repository = repository,
                patientId = patientId,
                onBack = onBack,
                visitId = visitId,
                onOpenVisit = { setScreen(Screen.Visit(patientId, it)) },
                onCloseVisit = { setScreen(Screen.Detail(patientId)) },
                onExportQr = onExportQr,
                onOpenUrl = onOpenUrl,
                onOpenPatientFolder = onOpenPatientFolder?.let { open -> { open(patientId) } },
                onEditPatientInfo = if (onEditPatientInfo != null) {
                    { firstName, lastName, dob, hospitalPatientId -> onEditPatientInfo(patientId, firstName, lastName, dob, hospitalPatientId) }
                } else {
                    null
                },
                onMoveReport = onMoveReport,
                todayIso = todayIso,
                onDeleteReport = onDeleteReport,
                onEditReportDevicesAndLeads = onEditReportDevicesAndLeads,
                onListDeviceTypeAliases = onListDeviceTypeAliases,
                onRescanVisit = onRescanVisit,
                onGetVisitFiles = onGetVisitFiles,
                onReadVisitFileBytes = onReadVisitFileBytes,
                onReadVisitFileText = onReadVisitFileText,
                onGetMergedAdditionalFields = onGetMergedAdditionalFields,
            )
        }
    }

    when (current) {
        Screen.Dashboard ->
            if (wide) {
                Row(Modifier.fillMaxSize()) {
                    Dashboard(null, Modifier.width(LIST_PANE_WIDTH).fillMaxHeight())
                    Box(Modifier.width(1.dp).fillMaxHeight().background(androidx.compose.material3.MaterialTheme.colorScheme.outlineVariant))
                    Box(Modifier.width(width - LIST_PANE_WIDTH - 1.dp).fillMaxHeight(), contentAlignment = androidx.compose.ui.Alignment.Center) {
                        Text(tr("Select a patient to see their visits"), color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } else {
                Dashboard(null, Modifier.fillMaxSize())
            }

        is Screen.Detail ->
            if (wide) {
                Row(Modifier.fillMaxSize()) {
                    Dashboard(current.patientId, Modifier.width(LIST_PANE_WIDTH).fillMaxHeight())
                    Box(Modifier.width(1.dp).fillMaxHeight().background(androidx.compose.material3.MaterialTheme.colorScheme.outlineVariant))
                    Detail(current.patientId, onBack = null, modifier = Modifier.width(width - LIST_PANE_WIDTH - 1.dp).fillMaxHeight())
                }
            } else {
                Detail(current.patientId, onBack = { setScreen(Screen.Dashboard) }, modifier = Modifier.fillMaxSize())
            }

        is Screen.Visit -> Detail(current.patientId, onBack = { setScreen(Screen.Detail(current.patientId)) }, modifier = Modifier.fillMaxSize(), visitId = current.reportId)

        Screen.Inbox -> InboxScreen(
            repository = repository,
            notificationState = notificationCenterState,
            activityTasks = activityTasks,
            refreshKey = pendingSortRefreshKey,
            sources = intakeSources,
            onOpenBundle = { setScreen(Screen.BundleReview(it)) },
            onOpenImportHistory = { setScreen(Screen.ImportHistory(Screen.Inbox)) },
            onReprocessUnmatched = onReprocessUnmatched,
        )

        is Screen.BundleReview -> BundleReviewScreen(
            repository = repository,
            bundleKey = current.key,
            refreshKey = pendingSortRefreshKey,
            onBack = { setScreen(Screen.Inbox) },
            onAssign = { bundleId, allTaskIds, assignments ->
                val onePatient = assignments.map { it.second }.distinct().singleOrNull()
                when {
                    bundleId != null && onResolveBundle != null && onePatient != null && assignments.size == allTaskIds.size -> onResolveBundle(bundleId, onePatient)
                    onResolveFiles != null -> onResolveFiles(assignments)
                    else -> assignments.forEach { (taskId, patientId) -> onApprovePendingSort?.invoke(taskId, patientId) }
                }
                setScreen(Screen.Inbox)
            },
            onDismiss = { bundleId, taskIds ->
                if (bundleId != null && onDismissBundle != null) onDismissBundle(bundleId) else taskIds.forEach { onDismissPendingSort?.invoke(it) }
                setScreen(Screen.Inbox)
            },
            onOpenFileSorter = { setScreen(Screen.PendingSort) },
            onReadFileBytes = onReadPendingSortFileBytes,
            onReadFileText = onReadPendingSortFileText,
        )

        Screen.Settings -> SettingsScreen(
            dataRootLabel = dataRootLabel,
            isReindexing = isReindexing,
            lastReindexSummary = lastReindexSummary,
            onBack = null,
            onPickDataRoot = onPickDataRoot,
            onReindex = onReindex,
            onClearLocalIndex = onClearLocalIndex,
            importDirLabel = importDirLabel,
            onPickImportDir = onPickImportDir,
            onReprocessUnmatched = onReprocessUnmatched,
            usbSourceDirs = usbSourceDirs,
            onAddUsbSourceDir = onAddUsbSourceDir,
            onRemoveUsbSourceDir = onRemoveUsbSourceDir,
            usbTargetDirLabel = usbTargetDirLabel,
            onPickUsbTargetDir = onPickUsbTargetDir,
            isReparsing = isReparsing,
            onReparseAll = onReparseAll,
            pendingSortCount = pendingSortCount,
            onOpenPendingSort = if (sortingAvailable) { { setScreen(Screen.Inbox) } } else null,
            onOpenDuplicates = onMergeDuplicates?.let { { setScreen(Screen.Duplicates) } },
            onOpenOrphanedVisits = if (onFindOrphanedVisits != null && onMoveOrphanedVisits != null) { { setScreen(Screen.OrphanedVisits) } } else null,
            onOpenImportHistory = { setScreen(Screen.ImportHistory(Screen.Settings)) },
            onOpenAliasSettings = if (onListDeviceTypeAliases != null) { { setScreen(Screen.AliasSettings) } } else null,
            isDeduping = isDeduping,
            onDedupReports = onDedupReports,
            appVersion = appVersion, update = update, language = language, onLanguageChange = onLanguageChange,
            themeMode = themeMode,
            onThemeModeChange = onThemeModeChange,
        )

        Screen.PendingSort -> PendingSortScreen(
            repository = repository,
            refreshKey = pendingSortRefreshKey,
            onBack = { setScreen(Screen.Inbox) },
            onApprove = { taskId, patientId -> onApprovePendingSort?.invoke(taskId, patientId) },
            onDismiss = { taskId -> onDismissPendingSort?.invoke(taskId) },
            onCreateNewPatient = onCreateNewPatientFromPendingSort,
            onManualAssign = onManualAssignPendingSort,
            onReadStagedFileBytes = onReadPendingSortFileBytes,
            onReadStagedFileText = onReadPendingSortFileText,
        )

        Screen.Duplicates -> DuplicatesScreen(
            repository = repository,
            refreshKey = duplicatesRefreshKey,
            onBack = { setScreen(Screen.Settings) },
            onMerge = { keeperId, loserIds -> onMergeDuplicates?.invoke(keeperId, loserIds) },
        )

        Screen.DeviceNews -> deviceNewsService?.let { service ->
            DeviceNewsScreen(newsService = service, onBack = null, onOpenUrl = onOpenUrl)
        } ?: Unit

        Screen.Portals -> onOpenUrl?.let { open -> io.github.alexanderlanganke.kardisynch.ui.webpanel.WebPortalsScreen(onOpenUrl = open, controller = portals) } ?: Unit

        Screen.OrphanedVisits -> if (onFindOrphanedVisits != null && onMoveOrphanedVisits != null) {
            OrphanedVisitsScreen(repository = repository, onBack = { setScreen(Screen.Settings) }, onScan = onFindOrphanedVisits, onMove = onMoveOrphanedVisits)
        } else {
            Unit
        }

        is Screen.ImportHistory -> ImportHistoryScreen(repository = repository, onBack = { setScreen(current.from) })

        Screen.AliasSettings -> if (onListDeviceTypeAliases != null) {
            AliasSettingsScreen(
                onBack = { setScreen(Screen.Settings) },
                onList = onListDeviceTypeAliases,
                onUpsertDevice = onUpsertDeviceTypeAlias ?: { _, _, _ -> Result.failure(IllegalStateException("Alias editing unavailable")) },
                onUpsertLead = onUpsertLeadTypeAlias ?: { _, _, _ -> Result.failure(IllegalStateException("Alias editing unavailable")) },
                onDelete = onDeleteDeviceTypeAlias ?: { _, _, _ -> Result.failure(IllegalStateException("Alias editing unavailable")) },
            )
        } else {
            Unit
        }
    }
}
