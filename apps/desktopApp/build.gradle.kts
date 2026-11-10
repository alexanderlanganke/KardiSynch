import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    jvmToolchain(21)
    jvm("desktop")

    sourceSets {
        val desktopMain by getting {
            dependencies {
                implementation(project(":core"))
                implementation(project(":data"))
                implementation(project(":ui"))
                implementation(compose.desktop.currentOs)
                implementation(compose.material3)
                implementation(libs.zxing.core)
                implementation(libs.sqldelight.sqlite.driver)
                implementation(libs.pdfbox)
            }
        }
        val desktopTest by getting {
            dependencies {
                implementation(kotlin("test"))
                implementation(libs.kotlinx.coroutines.test)
                implementation(libs.sqldelight.sqlite.driver)
            }
        }
    }
}

val appVersion: String = providers.gradleProperty("kardisynch.version").get()

compose.desktop {
    application {
        mainClass = "io.github.alexanderlanganke.kardisynch.apps.desktop.MainKt"
        jvmArgs += "-Dkardisynch.version=$appVersion"

        nativeDistributions {
            // Only Linux formats (issue #182): Windows (Msi) and macOS (Dmg)
            // installers need jpackage running ON that OS — Compose Desktop
            // can't cross-compile them from here, and there's no Windows/Mac
            // runner in this environment to verify a config addition against.
            // Electron's own build targets (package.json's `build` block)
            // are Linux AppImage, Windows NSIS, and a default macOS dmg —
            // matching that fully is follow-up work for whoever builds on
            // those platforms.
            targetFormats(TargetFormat.Deb, TargetFormat.Rpm)
            // Ship the complete JDK module set in the bundled runtime image.
            // Compose's default jlink image only contains a minimal module
            // list; anything outside it (java.sql for JDBC/SQLite,
            // java.naming, java.management, jdk.unsupported, ...) fails at
            // runtime on the user's machine with a JVM/NoClassDefFound error
            // that never shows up on the dev box. A few extra MB is the price
            // of "runs everywhere with nothing installed".
            includeAllModules = true
            packageName = "kardisynch"
            // jpackage (deb/rpm/msi) only accepts numeric versions; the full semver (with -beta.N) stays in kardisynch.version for the updater.
            packageVersion = appVersion.substringBefore("-")
            description = "KardiSynch — cardiac implantable device report synchronization"
            copyright = "© KardiSynch"
            vendor = "KardiSynch"

            linux {
                iconFile.set(project.file("packaging/icon.png"))
            }
        }

        buildTypes.release.proguard {
            configurationFiles.from(project.file("compose-desktop.pro"))
        }
    }
}
