package io.github.alexanderlanganke.kardisynch.apps.android

import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.zxing.BinaryBitmap
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.Executors

/**
 * Live QR scanner: the actual net-new capability issue #161 asked for
 * (scanning a CardioPal-style follow-up QR — already exported by the
 * desktop app since v2.19.0 — on a phone instead of needing a desktop to
 * read it). CameraX preview + a ZXing [MultiFormatReader] running on every
 * analyzed frame; calls [onDecoded] once with the first successfully
 * decoded text and stops (no continuous multi-scan UI yet).
 */
@Composable
fun QrScanScreen(onDecoded: (String) -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val reader = remember { MultiFormatReader() }
    val executor = remember { Executors.newSingleThreadExecutor() }
    // A plain remembered box, not mutableStateOf: this only guards against
    // decoding twice inside the analyzer callback (a background thread) and
    // must never trigger a recomposition itself.
    val decoded = remember { booleanArrayOf(false) }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                cameraProviderFuture.addListener({
                    val cameraProvider = cameraProviderFuture.get()
                    val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                    val analysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analysis.setAnalyzer(executor) { imageProxy ->
                        if (!decoded[0]) {
                            val text = decodeQr(imageProxy, reader)
                            if (text != null) {
                                decoded[0] = true
                                onDecoded(text)
                            }
                        }
                        imageProxy.close()
                    }
                    try {
                        cameraProvider.unbindAll()
                        cameraProvider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                    } catch (e: Exception) {
                        Log.e("QrScanScreen", "Failed to bind camera", e)
                    }
                }, ContextCompat.getMainExecutor(ctx))
                previewView
            },
        )
        MaterialTheme {
            TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.TopStart).padding(16.dp)) {
                Text("Cancel", color = androidx.compose.ui.graphics.Color.White)
            }
        }
    }
}

private fun decodeQr(imageProxy: ImageProxy, reader: MultiFormatReader): String? {
    val buffer = imageProxy.planes[0].buffer
    val data = ByteArray(buffer.remaining())
    buffer.get(data)
    val source = PlanarYUVLuminanceSource(
        data, imageProxy.width, imageProxy.height, 0, 0, imageProxy.width, imageProxy.height, false,
    )
    val bitmap = BinaryBitmap(HybridBinarizer(source))
    return try {
        reader.decode(bitmap).text
    } catch (e: NotFoundException) {
        null
    } finally {
        reader.reset()
    }
}
