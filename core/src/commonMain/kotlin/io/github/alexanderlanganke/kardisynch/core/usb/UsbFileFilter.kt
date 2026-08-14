package io.github.alexanderlanganke.kardisynch.core.usb

/** File extensions the parsers can actually consume — mirrors Electron's `usbWatcher.ts`. */
val SUPPORTED_USB_EXTENSIONS: Set<String> = setOf("pdf", "xml", "bnk", "pdd", "pkg", "log")

fun isSupportedUsbFile(filename: String): Boolean {
    val ext = filename.substringAfterLast('.', "").lowercase()
    return ext.isNotEmpty() && ext in SUPPORTED_USB_EXTENSIONS
}
