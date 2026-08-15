package io.github.alexanderlanganke.kardisynch.data

/**
 * SHA-256 hex digest of [bytes] — used by [KardiSynchRepository.dedupReports]
 * to verify two same-named files are byte-identical before discarding one
 * (name + size alone isn't enough: fixed-layout device reports can differ
 * while being byte-count equal). `expect`/`actual` rather than a shared
 * implementation because desktop and Android are separate KMP targets here
 * with no shared `jvmMain` source set — both actuals happen to use
 * `java.security.MessageDigest` since both platforms are JVM-based, but
 * there's no common source set to hang a single implementation on.
 */
expect fun sha256Hex(bytes: ByteArray): String
