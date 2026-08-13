plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.kotlinSerialization)
}

kotlin {
    // Pinned explicitly (rather than relying on whatever JDK Gradle finds
    // first) because this environment's only installed JDK is JRE-only.
    jvmToolchain(21)

    // Android/iOS targets are added once the corresponding SDKs are available
    // in the build environment (this one has neither). Named "desktop" now,
    // matching the eventual multi-target source-set layout, so no rename is
    // needed later.
    jvm("desktop")

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.serialization.json)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}
