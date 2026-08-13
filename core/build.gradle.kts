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
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
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
