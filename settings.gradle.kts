rootProject.name = "kardisynch-kmp"

pluginManagement {
    repositories {
        google()
        gradlePluginPortal()
        mavenCentral()
    }
}

plugins {
    // The only JDK installed in this environment is javac-less (JRE only) —
    // this lets Gradle auto-provision a full JDK toolchain for compiling/
    // running tests instead of failing on that JRE's missing JAVA_COMPILER
    // capability.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

// Android/iOS/Compose modules (data, ui, apps/desktopApp, apps/androidApp) are
// scaffolded once the corresponding SDKs are available in the build
// environment — this environment has neither the Android SDK nor Xcode.
// `core` has zero platform dependencies and needs neither, so it goes first
// (see the KMP migration plan for the full module sequence).
include(
    ":core",
    ":data",
    ":ui",
    ":apps:desktopApp",
    ":apps:androidApp",
)
