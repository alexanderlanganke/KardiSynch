plugins {
    alias(libs.plugins.kotlinMultiplatform) apply false
    alias(libs.plugins.kotlinSerialization) apply false
    alias(libs.plugins.ktlint) apply false
}

subprojects {
    apply(plugin = "org.jlleitschuh.gradle.ktlint")

    plugins.withId("org.jlleitschuh.gradle.ktlint") {
        tasks.withType<org.jlleitschuh.gradle.ktlint.tasks.BaseKtLintCheckTask>().configureEach {
            exclude { entry -> entry.file.path.contains("/build/") }
        }
    }
}
