plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidLibrary)
    alias(libs.plugins.kotlinSerialization)
}

kotlin {
    // Pinned explicitly (rather than relying on whatever JDK Gradle finds
    // first) because this environment's only installed JDK is JRE-only.
    jvmToolchain(21)

    // iOS isn't wired up yet (needs Xcode on Apple hardware — see the KMP
    // migration plan). Named "desktop" now, matching the eventual
    // multi-target source-set layout, so no rename is needed later.
    jvm("desktop")
    androidTarget()

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.serialization.json)
            // `api`, not `implementation`: core's public surface exposes
            // ktor's HttpClient directly (DeviceNewsFetcher's constructor,
            // createDeviceNewsHttpClient's return type) — consumers like
            // apps:desktopApp need it on their own compile classpath, not
            // just core's internal one.
            //
            // CIO is a pure-Kotlin/coroutines engine (no native/platform
            // code), so — unlike most Ktor engines — it works from a single
            // commonMain dependency across both current targets (desktop
            // JVM, Android) without a separate per-platform engine artifact.
            api(libs.ktor.client.core)
            implementation(libs.ktor.client.cio)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
        }
    }
}

android {
    namespace = "io.github.alexanderlanganke.kardisynch.core"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    defaultConfig {
        minSdk = libs.versions.android.minSdk.get().toInt()
    }
}
