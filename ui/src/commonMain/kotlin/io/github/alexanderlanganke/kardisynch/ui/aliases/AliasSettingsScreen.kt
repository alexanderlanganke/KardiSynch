package io.github.alexanderlanganke.kardisynch.ui.aliases

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import io.github.alexanderlanganke.kardisynch.core.aliases.AliasKind
import io.github.alexanderlanganke.kardisynch.core.aliases.DeviceTypeAlias
import io.github.alexanderlanganke.kardisynch.core.aliases.LeadAliasAttrs
import kotlinx.coroutines.launch

/**
 * Browses/edits the `(manufacturer, model) -> device type / lead connector`
 * reference data learned from prior manual-correction prompts during import
 * (issue #184's backend). Its own doc comment on [io.github.alexanderlanganke.kardisynch.data.KardiSynchRepository.listDeviceTypeAliases]
 * explicitly flagged this as "deliberately backend-only for now" — first
 * screen for it, per the UI-parity plan's Phase 1. Mirrors Electron's
 * `DeviceTypeAliasesPanel` (in `Settings.tsx`'s Database tab), minus its
 * per-row type/connector Select (edit here is delete-and-re-add via the
 * form below, not inline).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AliasSettingsScreen(
    onBack: () -> Unit,
    onList: suspend () -> List<DeviceTypeAlias>,
    onUpsertDevice: suspend (manufacturer: String, model: String, type: String) -> Result<Unit>,
    onUpsertLead: suspend (manufacturer: String, model: String, attrs: LeadAliasAttrs) -> Result<Unit>,
    onDelete: suspend (manufacturer: String, model: String, kind: AliasKind) -> Result<Unit>,
) {
    var aliases by remember { mutableStateOf<List<DeviceTypeAlias>?>(null) }
    var manufacturer by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var type by remember { mutableStateOf("") }
    var connector by remember { mutableStateOf("") }
    var isLead by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun reload() { aliases = onList() }
    LaunchedEffect(Unit) { reload() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Device & lead type aliases") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            Card(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Add or update an alias", style = MaterialTheme.typography.titleSmall)
                    OutlinedTextField(manufacturer, { manufacturer = it }, label = { Text("Manufacturer") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                    OutlinedTextField(model, { model = it }, label = { Text("Model") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                    Row(modifier = Modifier.padding(top = 8.dp)) {
                        TextButton(onClick = { isLead = false }) { Text(if (!isLead) "● Device" else "○ Device") }
                        TextButton(onClick = { isLead = true }) { Text(if (isLead) "● Lead" else "○ Lead") }
                    }
                    OutlinedTextField(type, { type = it }, label = { Text("Type") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                    if (isLead) {
                        OutlinedTextField(connector, { connector = it }, label = { Text("Connector (optional)") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                    }
                    errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
                    Button(
                        onClick = {
                            scope.launch {
                                val result = if (isLead) {
                                    onUpsertLead(manufacturer, model, LeadAliasAttrs(type.ifBlank { null }, connector.ifBlank { null }))
                                } else {
                                    onUpsertDevice(manufacturer, model, type)
                                }
                                errorMessage = result.exceptionOrNull()?.message
                                if (result.isSuccess) {
                                    manufacturer = ""; model = ""; type = ""; connector = ""
                                    reload()
                                }
                            }
                        },
                        enabled = manufacturer.isNotBlank() && model.isNotBlank() && type.isNotBlank(),
                        modifier = Modifier.padding(top = 12.dp),
                    ) { Text("Save") }
                }
            }

            val current = aliases
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
                ) { Text("No learned aliases yet — they're recorded automatically when you correct a device/lead type during import.") }

                else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(current, key = { "${it.kind}|${it.manufacturer}|${it.model}" }) { alias ->
                        Card(modifier = Modifier.fillMaxWidth().padding(16.dp, 4.dp)) {
                            Row(
                                modifier = Modifier.padding(12.dp).fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column {
                                    Text("${alias.manufacturer} · ${alias.model}", style = MaterialTheme.typography.titleSmall)
                                    val detail = if (alias.kind == AliasKind.LEAD) {
                                        "Lead: ${alias.type}${alias.connector?.let { " ($it)" } ?: ""}"
                                    } else {
                                        "Device: ${alias.type}"
                                    }
                                    Text(detail, style = MaterialTheme.typography.bodyMedium)
                                }
                                TextButton(onClick = { scope.launch { onDelete(alias.manufacturer, alias.model, alias.kind); reload() } }) { Text("Delete") }
                            }
                        }
                    }
                }
            }
        }
    }
}
