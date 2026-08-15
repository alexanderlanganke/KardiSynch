package io.github.alexanderlanganke.kardisynch.ui.news

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.alexanderlanganke.kardisynch.core.news.CachedDeviceNewsService
import io.github.alexanderlanganke.kardisynch.core.news.DeviceNewsItem
import kotlinx.coroutines.launch

/**
 * A generic, non-patient-specific cardiac-device news/recall feed (issue
 * #192) — ported from `DeviceNews.tsx`. Openable from the dashboard;
 * fetches automatically on first open (cached for an hour, see
 * [CachedDeviceNewsService]'s doc comment), with a manual "Refresh" action
 * for a forced re-fetch. [onOpenUrl] is platform-specific (opens the
 * system browser, same as issue #175's MRI-check links) — pass null to
 * hide the per-item "Open" action.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceNewsScreen(
    newsService: CachedDeviceNewsService,
    onBack: () -> Unit,
    onOpenUrl: ((String) -> Unit)? = null,
) {
    var items by remember { mutableStateOf<List<DeviceNewsItem>?>(null) }
    var isRefreshing by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load(forceRefresh: Boolean) {
        isRefreshing = true
        errorMessage = null
        try {
            val result = newsService.getDeviceNews(forceRefresh)
            items = result
            if (result.isEmpty() && forceRefresh) errorMessage = "No results — sources may be unavailable right now."
        } catch (e: Exception) {
            errorMessage = "Failed to load: ${e.message}"
        } finally {
            isRefreshing = false
        }
    }

    LaunchedEffect(Unit) { load(forceRefresh = false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Device News") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            Column(modifier = Modifier.fillMaxWidth().padding(16.dp, 8.dp)) {
                Button(
                    onClick = { scope.launch { load(forceRefresh = true) } },
                    enabled = !isRefreshing,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (isRefreshing) "Refreshing..." else "Refresh") }
                errorMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp)) }
            }

            val current = items
            when {
                current == null -> Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) { CircularProgressIndicator() }

                current.isEmpty() -> Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) { Text("No news available right now.", style = MaterialTheme.typography.bodyMedium) }

                else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(current, key = { it.id }) { item -> DeviceNewsCard(item, onOpenUrl) }
                }
            }
        }
    }
}

@Composable
private fun DeviceNewsCard(item: DeviceNewsItem, onOpenUrl: ((String) -> Unit)?) {
    Card(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            AssistChip(onClick = {}, enabled = false, label = { Text(item.type) })
            Text(item.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
            Text("${item.source} · ${item.date}", style = MaterialTheme.typography.bodySmall)
            Text(item.summary, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
            if (onOpenUrl != null) {
                TextButton(onClick = { onOpenUrl(item.url) }, modifier = Modifier.padding(top = 4.dp)) { Text("Open") }
            }
        }
    }
}
