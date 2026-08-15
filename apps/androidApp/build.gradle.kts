import java.util.Properties

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
}

/**
 * Release signing (issue #182) — reads from a git-ignored `keystore.properties`
 * next to this file (never a real keystore or its credentials committed).
 * Absent that file, [releaseSigningProps] is null and the release build type
 * below falls back to AGP's default (unsigned) — same as before this
 * change, so a contributor without real signing secrets isn't blocked.
 *
 * Expected `keystore.properties` shape:
 *   storeFile=/absolute/or/relative/path/to/release.jks
 *   storePassword=...
 *   keyAlias=...
 *   keyPassword=...
 */
val keystorePropertiesFile = file("keystore.properties")
val releaseSigningProps: Properties? = if (keystorePropertiesFile.exists()) {
    Properties().apply { keystorePropertiesFile.inputStream().use { load(it) } }
} else {
    null
}

kotlin {
    jvmToolchain(21)
    androidTarget()

    sourceSets {
        androidMain.dependencies {
            implementation(project(":core"))
            implementation(project(":data"))
            implementation(project(":ui"))
            implementation(compose.material3)
            implementation(libs.androidx.activity.compose)
            implementation(libs.androidx.core.ktx)
            implementation(libs.androidx.documentfile)
            implementation(libs.androidx.camera.core)
            implementation(libs.androidx.camera.camera2)
            implementation(libs.androidx.camera.lifecycle)
            implementation(libs.androidx.camera.view)
            implementation(libs.zxing.core)
        }
    }
}

android {
    namespace = "io.github.alexanderlanganke.kardisynch.apps.android"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "io.github.alexanderlanganke.kardisynch"
        minSdk = libs.versions.android.minSdk.get().toInt()
        targetSdk = libs.versions.android.targetSdk.get().toInt()
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (releaseSigningProps != null) {
            create("release") {
                storeFile = file(releaseSigningProps.getProperty("storeFile"))
                storePassword = releaseSigningProps.getProperty("storePassword")
                keyAlias = releaseSigningProps.getProperty("keyAlias")
                keyPassword = releaseSigningProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Minification/R8 deliberately left off (issue #182): this port
            // has no Android emulator/device available to verify a minified
            // build's runtime behavior (R8 silently stripping a
            // reflectively-accessed class fails at runtime, not build time)
            // — enabling it blind, this early in the port, risks shipping a
            // release build that crashes despite compiling cleanly.
            isMinifyEnabled = false
            if (releaseSigningProps != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}
