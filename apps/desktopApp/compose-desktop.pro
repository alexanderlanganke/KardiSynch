# Optional/runtime-only backends pulled in transitively by PDFBox (commons-logging,
# BouncyCastle for PDF public-key encryption) and Ktor that are never on the
# classpath in this desktop app. ProGuard's "unresolved reference" warnings for
# them are fatal by default (-ignorewarnings is not set); we don't use these
# code paths, so it's safe to tell ProGuard not to worry about them.
-dontwarn org.apache.logging.log4j.**
-dontwarn org.apache.log4j.**
-dontwarn org.apache.avalon.framework.**
-dontwarn org.apache.log.**
-dontwarn javax.servlet.**
-dontwarn org.bouncycastle.**
-dontwarn java.lang.invoke.MethodHandle
-dontwarn org.apache.commons.logging.**
