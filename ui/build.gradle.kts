plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidLibrary)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    jvmToolchain(21)

    jvm("desktop")
    androidTarget()

    sourceSets {
        commonMain.dependencies {
            implementation(project(":core"))
            implementation(project(":data"))
            implementation(libs.kotlinx.coroutines.core)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.materialIconsExtended)
            implementation(compose.runtime)
            implementation(compose.ui)
        }
        val desktopMain by getting {
            dependencies {
                // Raw document viewer (issue #197/#198's follow-up UI-parity
                // plan, Phase 11) — pure-JVM, no native deps, so it works
                // from a single artifact here the way Android instead uses
                // its own built-in android.graphics.pdf.PdfRenderer (no
                // extra dependency needed there at all).
                implementation(libs.pdfbox)
            }
        }
        val desktopTest by getting {
            dependencies {
                implementation(kotlin("test"))
                // Skiko's native library (needed by toComposeImageBitmap(),
                // exercised in PdfPageRendererTest) isn't pulled in by
                // commonMain's plain compose.ui alone — desktopApp gets it
                // transitively via compose.desktop.currentOs for the real
                // app; tests need the same runtime dependency explicitly.
                implementation(compose.desktop.currentOs)
            }
        }
    }
}

android {
    namespace = "io.github.alexanderlanganke.kardisynch.ui"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    defaultConfig {
        minSdk = libs.versions.android.minSdk.get().toInt()
    }
}
