package io.github.alexanderlanganke.kardisynch.ui.importhistory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository
import io.github.alexanderlanganke.kardisynch.data.db.ImportEvents
import io.github.alexanderlanganke.kardisynch.data.db.ImportSessions

/**
 * Browses the import session/event audit trail (issue #174's backend,
 * wired to a screen for the first time here per the UI-parity plan's Phase
 * 1). Electron's standalone `ImportHistory.tsx` screen is confirmed
 * unreachable there (no route/nav entry) — this ports the underlying
 * data-browsing capability its `NotificationCenter` Imports tab exposes,
 * not that dead route. Read-only: unlike Electron's history view, there's
 * no "Move" per-event reassignment action here, matching what's actually
 * reachable in the shipped Electron app today (see the plan's audit notes).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportHistoryScreen(repository: KardiSynchRepository, onBack: () -> Unit) {
    var sessions by remember { mutableStateOf<List<ImportSessions>?>(null) }
    var selectedSessionId by remember { mutableStateOf<String?>(null) }
    var events by remember { mutableStateOf<List<ImportEvents>?>(null) }

    LaunchedEffect(Unit) { sessions = repository.getImportHistory() }
    LaunchedEffect(selectedSessionId) {
        val sessionId = selectedSessionId
        events = if (sessionId != null) repository.getImportSessionEvents(sessionId) else null
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (selectedSessionId != null) "Import session" else "Import history") },
                navigationIcon = {
                    TextButton(onClick = { if (selectedSessionId != null) selectedSessionId = null else onBack() }) { Text("Back") }
                },
            )
        },
    ) { padding ->
        val sessionId = selectedSessionId
        when {
            sessionId != null -> {
                val currentEvents = events
                when {
                    currentEvents == null -> Column(
                        modifier = Modifier.fillMaxSize().padding(padding),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) { CircularProgressIndicator() }

                    currentEvents.isEmpty() -> Column(
                        modifier = Modifier.fillMaxSize().padding(padding),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) { Text("No events recorded for this session.") }

                    else -> LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                        items(currentEvents, key = { it.id }) { event ->
                            Card(modifier = Modifier.fillMaxWidth().padding(16.dp, 6.dp)) {
                                Column(modifier = Modifier.padding(12.dp)) {
                                    Text(event.filePath, style = MaterialTheme.typography.bodyMedium)
                                    Text("${event.status} · ${event.timestamp}", style = MaterialTheme.typography.bodySmall)
                                    event.message?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                                }
                            }
                        }
                    }
                }
            }

            else -> {
                val currentSessions = sessions
                when {
                    currentSessions == null -> Column(
                        modifier = Modifier.fillMaxSize().padding(padding),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) { CircularProgressIndicator() }

                    currentSessions.isEmpty() -> Column(
                        modifier = Modifier.fillMaxSize().padding(padding),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) { Text("No import sessions recorded yet.") }

                    else -> LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                        items(currentSessions, key = { it.id }) { session ->
                            Card(
                                modifier = Modifier.fillMaxWidth().padding(16.dp, 6.dp),
                                onClick = { selectedSessionId = session.id },
                            ) {
                                Column(modifier = Modifier.padding(12.dp)) {
                                    Text(session.timestamp, style = MaterialTheme.typography.titleSmall)
                                    Text(session.status ?: "Unknown status", style = MaterialTheme.typography.bodyMedium)
                                    session.summary?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
