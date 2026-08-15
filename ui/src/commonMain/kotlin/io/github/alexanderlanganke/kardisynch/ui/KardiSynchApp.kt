package io.github.alexanderlanganke.kardisynch.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
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
import io.github.alexanderlanganke.kardisynch.ui.dashboard.PatientDashboardScreen
import io.github.alexanderlanganke.kardisynch.ui.detail.PatientDetailScreen
import io.github.alexanderlanganke.kardisynch.ui.duplicates.DuplicatesScreen
import io.github.alexanderlanganke.kardisynch.ui.news.DeviceNewsScreen
import io.github.alexanderlanganke.kardisynch.ui.pendingsort.PendingSortScreen
import io.github.alexanderlanganke.kardisynch.ui.settings.SettingsScreen
import io.github.alexanderlanganke.kardisynch.core.news.CachedDeviceNewsService

private sealed interface Screen {
    data object Dashboard : Screen
    data class Detail(val patientId: String) : Screen
    data object Settings : Screen
    data object PendingSort : Screen
    data object Duplicates : Screen
    data object DeviceNews : Screen
}

/**
 * Top-level navigation shell, shared across every KMP target — Phase 1
 * read-only scope (Dashboard/Detail/Settings). Each app shell (desktopApp,
 * androidApp) supplies the repository and the settings-screen callbacks
 * (data-root picking is inherently platform-specific, see [SettingsScreen]'s
 * doc comment).
 *
 * Theming follows the system light/dark setting (issue #196) via Material3's
 * built-in [isSystemInDarkTheme] — Electron's version has a manual
 * light/dark/system toggle with its own persisted override
 * (`ThemeProvider.tsx`); only the "system" behavior is ported here, not a
 * user-facing override, since Compose's default already covers the common
 * case and a manual toggle is closer to new feature work than a port.
 *
 * [appVersion]/[notificationMessage] surface two more app-shell pieces
 * (issue #196): a version line in Settings' new "About" section, and a
 * transient [SnackbarHost] for whatever the platform layer's watchers
 * report (import/reparse/merge results, etc.) — mirrors Electron's
 * `sendNotification` toast, without its persistent notification-center
 * popover (out of scope: this port has nowhere near Electron's volume of
 * background notification sources yet to justify one).
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
    onOpenUrl: ((String) -> Unit)? = null,
    onEditPatientInfo: ((patientId: String, firstName: String, lastName: String, dob: String, hospitalPatientId: String?) -> Unit)? = null,
    onMoveReport: ((reportId: String, fromPatientId: String, toPatientId: String) -> Unit)? = null,
    duplicatesRefreshKey: Any = Unit,
    onMergeDuplicates: ((keeperId: String, loserIds: List<String>) -> Unit)? = null,
    appVersion: String? = null,
    notificationMessage: String? = null,
    notificationKey: Any? = null,
    deviceNewsService: CachedDeviceNewsService? = null,
) {
    var screen by remember { mutableStateOf<Screen>(Screen.Dashboard) }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(notificationKey) {
        notificationMessage?.let { snackbarHostState.showSnackbar(it) }
    }

    val colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()

    MaterialTheme(colorScheme = colorScheme) {
        Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { snackbarPadding ->
            Box(modifier = Modifier.padding(snackbarPadding)) {
                when (val current = screen) {
            is Screen.Dashboard -> PatientDashboardScreen(
                repository = repository,
                onOpenPatient = { screen = Screen.Detail(it) },
                onOpenSettings = { screen = Screen.Settings },
                onOpenDeviceNews = deviceNewsService?.let { { screen = Screen.DeviceNews } },
            )

            is Screen.Detail -> PatientDetailScreen(
                repository = repository,
                patientId = current.patientId,
                onBack = { screen = Screen.Dashboard },
                onExportQr = onExportQr,
                onOpenUrl = onOpenUrl,
                onEditPatientInfo = if (onEditPatientInfo != null) {
                    { firstName, lastName, dob, hospitalPatientId ->
                        onEditPatientInfo(current.patientId, firstName, lastName, dob, hospitalPatientId)
                    }
                } else {
                    null
                },
                onMoveReport = onMoveReport,
            )

            is Screen.Settings -> SettingsScreen(
                dataRootLabel = dataRootLabel,
                isReindexing = isReindexing,
                lastReindexSummary = lastReindexSummary,
                onBack = { screen = Screen.Dashboard },
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
                onOpenPendingSort = if (onApprovePendingSort != null || onDismissPendingSort != null) {
                    { screen = Screen.PendingSort }
                } else {
                    null
                },
                onOpenDuplicates = onMergeDuplicates?.let { { screen = Screen.Duplicates } },
                appVersion = appVersion,
            )

            is Screen.PendingSort -> PendingSortScreen(
                repository = repository,
                refreshKey = pendingSortRefreshKey,
                onBack = { screen = Screen.Settings },
                onApprove = { taskId, patientId -> onApprovePendingSort?.invoke(taskId, patientId) },
                onDismiss = { taskId -> onDismissPendingSort?.invoke(taskId) },
            )

            is Screen.Duplicates -> DuplicatesScreen(
                repository = repository,
                refreshKey = duplicatesRefreshKey,
                onBack = { screen = Screen.Settings },
                onMerge = { keeperId, loserIds -> onMergeDuplicates?.invoke(keeperId, loserIds) },
            )

            is Screen.DeviceNews -> deviceNewsService?.let { service ->
                DeviceNewsScreen(
                    newsService = service,
                    onBack = { screen = Screen.Dashboard },
                    onOpenUrl = onOpenUrl,
                )
            }
                }
            }
        }
    }
}
