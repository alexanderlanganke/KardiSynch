package io.github.alexanderlanganke.kardisynch.core.matching

import io.github.alexanderlanganke.kardisynch.core.model.BatteryData
import io.github.alexanderlanganke.kardisynch.core.model.DeviceInfo
import io.github.alexanderlanganke.kardisynch.core.model.UnifiedReport

/**
 * Merges a newly-imported [incoming] report into an [existing] one already
 * stored for the same visit — e.g. a same-day PDF alongside an XML export,
 * or a second file landing in a same-day-reused interrogation ([pickSameDayReport]).
 * Ported from `storeFile`'s merge block (src/main/storage.ts): leads and
 * additional fields are unioned; battery and device identity fall back to
 * whichever side actually has data, so whichever file was stored last never
 * silently blanks out data the other file contributed.
 */
fun mergeReports(existing: UnifiedReport, incoming: UnifiedReport): UnifiedReport {
    val mergedLeads = existing.leads.toMutableList()
    for (lead in incoming.leads) {
        val alreadyPresent = mergedLeads.any { ex ->
            (!ex.serial.isNullOrEmpty() && ex.serial == lead.serial) ||
                (!ex.model.isNullOrEmpty() && ex.model == lead.model && ex.name == lead.name)
        }
        if (!alreadyPresent) mergedLeads.add(lead)
    }

    fun hasIdentity(v: String?) = !v.isNullOrEmpty() && v != "Unknown"
    fun preferField(incomingVal: String, existingVal: String) = if (hasIdentity(incomingVal)) incomingVal else existingVal.ifEmpty { incomingVal }
    fun hasBatteryData(b: BatteryData) = b.voltage != null || b.lastChargeTime != null || !b.status.isNullOrEmpty()

    return incoming.copy(
        leads = mergedLeads,
        additionalFields = existing.additionalFields + incoming.additionalFields,
        battery = if (hasBatteryData(incoming.battery)) incoming.battery else existing.battery,
        manufacturer = preferField(incoming.manufacturer, existing.manufacturer),
        device = DeviceInfo(
            type = preferField(incoming.device.type, existing.device.type),
            model = preferField(incoming.device.model, existing.device.model),
            serialNumber = preferField(incoming.device.serialNumber, existing.device.serialNumber),
            implantDate = incoming.device.implantDate ?: existing.device.implantDate,
        ),
    )
}
