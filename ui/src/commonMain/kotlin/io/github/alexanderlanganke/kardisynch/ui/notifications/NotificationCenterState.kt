package io.github.alexanderlanganke.kardisynch.ui.notifications

import androidx.compose.runtime.mutableStateListOf

data class UiNotification(
    val id: Long,
    val message: String,
    val read: Boolean = false,
)

/**
 * In-memory, session-only history of the app shell's single-string
 * `notificationMessage`/`notificationKey` channel (see [io.github.alexanderlanganke.kardisynch.ui.KardiSynchApp]) —
 * this is the same string that already drives the transient snackbar, now
 * also kept around so [NotificationCenterBell]'s Notifications tab has
 * something to show. Unlike Electron's `onNotify(type, message)`, that
 * channel carries no severity and no wall-clock timestamp (commonMain has
 * no platform clock, and this port already avoids pulling in
 * kotlinx-datetime for lesser reasons — see `VisitMatch.kt`), so entries
 * here are plain, ordered newest-first by insertion.
 */
class NotificationCenterState {
    private val backing = mutableStateListOf<UiNotification>()
    private var nextId = 0L

    val notifications: List<UiNotification> get() = backing

    fun push(message: String) {
        backing.add(0, UiNotification(nextId++, message))
    }

    fun markAllRead() {
        for (i in backing.indices) backing[i] = backing[i].copy(read = true)
    }

    fun clearAll() {
        backing.clear()
    }

    fun remove(id: Long) {
        backing.removeAll { it.id == id }
    }
}
