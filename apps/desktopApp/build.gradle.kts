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
            }
        }
    }
}

compose.desktop {
    application {
        mainClass = "io.github.alexanderlanganke.kardisynch.apps.desktop.MainKt"

        nativeDistributions {
            targetFormats(TargetFormat.Deb, TargetFormat.Rpm)
            packageName = "kardisynch"
            packageVersion = "0.1.0"
        }
    }
}
