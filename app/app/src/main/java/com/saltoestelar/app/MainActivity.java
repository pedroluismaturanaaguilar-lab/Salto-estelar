package com.saltoestelar.mobile;

import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public final class MainActivity extends Activity {
    private static final int MEDIA_PERMISSION_REQUEST = 802;
    private static final String GAME_URL = "https://salto-estelar.onrender.com/";
    private WebView gameView;
    private PermissionRequest pendingMediaRequest;
    private boolean triedOfflineFallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        gameView = new WebView(this);
        gameView.getSettings().setJavaScriptEnabled(true);
        gameView.getSettings().setDomStorageEnabled(true);
        gameView.getSettings().setAllowFileAccess(true);
        gameView.getSettings().setAllowContentAccess(true);
        gameView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        gameView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, android.webkit.WebResourceRequest request,
                                        android.webkit.WebResourceError error) {
                if (request.isForMainFrame() && !triedOfflineFallback) {
                    triedOfflineFallback = true;
                    view.loadUrl("file:///android_asset/public/index.html");
                }
            }
        });
        gameView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> requestMediaPermissions(request));
            }
        });
        setContentView(gameView);
        gameView.loadUrl(GAME_URL);
    }

    private void requestMediaPermissions(PermissionRequest request) {
        boolean needsCamera = false;
        boolean needsAudio = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) needsCamera = true;
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) needsAudio = true;
        }
        boolean cameraOk = !needsCamera || checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
        boolean audioOk = !needsAudio || checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        if (cameraOk && audioOk) {
            request.grant(request.getResources());
            return;
        }
        pendingMediaRequest = request;
        String[] permissions = needsCamera && needsAudio
                ? new String[]{android.Manifest.permission.CAMERA, android.Manifest.permission.RECORD_AUDIO}
                : new String[]{needsCamera ? android.Manifest.permission.CAMERA : android.Manifest.permission.RECORD_AUDIO};
        requestPermissions(permissions, MEDIA_PERMISSION_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MEDIA_PERMISSION_REQUEST || pendingMediaRequest == null) return;
        boolean granted = true;
        for (int result : grantResults) granted &= result == PackageManager.PERMISSION_GRANTED;
        if (granted) pendingMediaRequest.grant(pendingMediaRequest.getResources());
        else pendingMediaRequest.deny();
        pendingMediaRequest = null;
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (gameView != null && gameView.canGoBack()) gameView.goBack();
        else super.onBackPressed();
    }
}

