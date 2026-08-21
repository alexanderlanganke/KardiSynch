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

compose.desktop {
    application {
        mainClass = "io.github.alexanderlanganke.kardisynch.apps.desktop.MainKt"

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
            packageName = "kardisynch"
            packageVersion = "0.1.0"
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
