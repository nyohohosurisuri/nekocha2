
import { dbService } from './db';
import { DropboxTokens, DropboxSettings, ChatSession, SessionData } from '../types';

const APP_KEY = 'pn1qqb7cs6ougl4'; // User requested App Key
const METADATA_PATH = '/nekocha_backup.json'; // Keep current app's filename
const LOCK_FILE_PATH = '/.sync_lock';

// --- PKCE Helper Functions (Robust Fallback Version) ---

// Generate random string (Verifier)
function generateCodeVerifier() {
    const length = 128;
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

    // Try to use secure crypto if available
    if (window.crypto && window.crypto.getRandomValues) {
        const values = new Uint8Array(length);
        window.crypto.getRandomValues(values);
        let text = '';
        for (let i = 0; i < length; i++) {
            text += possible.charAt(values[i] % possible.length);
        }
        return text;
    } else {
        // Fallback for non-secure contexts (Math.random)
        console.warn("[Dropbox] Using insecure random generator for PKCE (Non-HTTPS context detected)");
        let text = '';
        for (let i = 0; i < length; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}

// Generate Challenge (S256 or Plain)
async function generateCodeChallenge(verifier: string): Promise<{ challenge: string, method: 'S256' | 'plain' }> {
    // Check if SubtleCrypto is available (Requires HTTPS or Localhost)
    if (window.crypto && window.crypto.subtle) {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(verifier);
            const hash = await window.crypto.subtle.digest('SHA-256', data);
            const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            return { challenge: base64, method: 'S256' };
        } catch (e) {
            console.warn("[Dropbox] Crypto digest failed, falling back to plain.", e);
        }
    }

    // Fallback to 'plain' method if crypto.subtle is unavailable
    // This allows the app to work in HTTP preview environments
    console.log("[Dropbox] Using 'plain' PKCE method due to missing secure context.");
    return { challenge: verifier, method: 'plain' };
}

// Helper to get normalized redirect URI (removes trailing slash to avoid mismatch)
function getRedirectUri() {
    // Return the full path including trailing slash if present (GitHub Pages usually adds it)
    return window.location.origin + window.location.pathname;
}

export const dropboxService = {
    // --- Auth Flow ---

    // Expose for UI to display
    getCurrentRedirectUri: () => {
        return getRedirectUri();
    },

    // Generates the Auth URL and saves the verifier.
    // Navigation should be handled by the caller to ensure popups aren't blocked.
    generateAuthUrl: async (): Promise<string> => {
        try {
            const verifier = generateCodeVerifier();
            const { challenge, method } = await generateCodeChallenge(verifier);

            // Save verifier for the callback
            localStorage.setItem('dropbox_code_verifier', verifier);

            const redirectUri = getRedirectUri();
            // Added account_info.read scope as per recent debugging
            const scopes = ['files.content.write', 'files.content.read', 'account_info.read'].join(' ');

            const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${APP_KEY}&response_type=code&code_challenge=${challenge}&code_challenge_method=${method}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;

            console.log(`[Dropbox] Auth URL generated. Method: ${method}, RedirectURI: ${redirectUri}`);
            return authUrl;

        } catch (e: any) {
            console.error("Failed to generate Dropbox auth URL:", e);
            throw e;
        }
    },

    handleAuthCallback: async (code: string): Promise<DropboxTokens> => {
        const verifier = localStorage.getItem('dropbox_code_verifier');
        if (!verifier) {
            throw new Error("PKCE Code Verifier not found. Please try connecting again.");
        }

        const redirectUri = getRedirectUri();

        const params = new URLSearchParams();
        params.append('code', code);
        params.append('grant_type', 'authorization_code');
        params.append('client_id', APP_KEY);
        params.append('redirect_uri', redirectUri);
        params.append('code_verifier', verifier);

        const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error_description || 'Failed to exchange code');
        }

        const data = await response.json();
        // Remove code verifier
        localStorage.removeItem('dropbox_code_verifier');

        const tokens: DropboxTokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in,
            expires_at: Date.now() + (data.expires_in - 300) * 1000,
            account_id: data.account_id,
            uid: data.uid,
            scope: data.scope,
            token_type: data.token_type
        };

        // Save tokens to DB
        await dbService.saveGlobalConfig('dropboxTokens', tokens);
        return tokens;
    },

    // --- Token Management ---

    getTokens: async (): Promise<DropboxTokens | null> => {
        return await dbService.getGlobalConfig('dropboxTokens');
    },

    isAuthenticated: async (): Promise<boolean> => {
        const tokens = await dbService.getGlobalConfig('dropboxTokens');
        return !!tokens;
    },

    refreshAccessToken: async (refreshToken: string): Promise<DropboxTokens> => {
        console.log('[Dropbox] Refreshing token...');
        const params = new URLSearchParams();
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', refreshToken);
        params.append('client_id', APP_KEY);

        const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });

        if (!response.ok) throw new Error('Failed to refresh token');

        const data = await response.json();
        const currentTokens = await dropboxService.getTokens();

        const newTokens: DropboxTokens = {
            ...currentTokens!,
            access_token: data.access_token,
            expires_in: data.expires_in,
            expires_at: Date.now() + (data.expires_in - 300) * 1000,
        };

        await dbService.saveGlobalConfig('dropboxTokens', newTokens);
        return newTokens;
    },

    // --- API Request Wrapper ---

    request: async (domain: 'api' | 'content', endpoint: string, options: RequestInit = {}, retryCount = 0): Promise<any> => {
        let tokens = await dropboxService.getTokens();
        if (!tokens) throw new Error("Dropbox not connected");

        if (Date.now() >= tokens.expires_at) {
            if (tokens.refresh_token) {
                tokens = await dropboxService.refreshAccessToken(tokens.refresh_token);
            } else {
                console.warn("[Dropbox] Token expired and no refresh token available.");
                // Try anyway, maybe clock skew, or let it fail 401
            }
        }

        const url = `https://${domain}.dropboxapi.com/2${endpoint}`;
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${tokens?.access_token}`,
            ...(options.headers as Record<string, string>),
        };

        try {
            const response = await fetch(url, { ...options, headers });

            if (response.status === 401 && retryCount === 0 && tokens?.refresh_token) {
                console.log('[Dropbox] 401 Unauthorized, forcing refresh...');
                try {
                    await dropboxService.refreshAccessToken(tokens.refresh_token);
                    return dropboxService.request(domain, endpoint, options, 1);
                } catch (refreshError) {
                    console.error('[Dropbox] Token refresh failed:', refreshError);
                    // Clear invalid tokens
                    await dbService.saveGlobalConfig('dropboxTokens', null);
                    throw new Error('Dropboxセッションの有効期限が切れました。設定画面から再接続してください。');
                }
            }

            if (response.status === 401) {
                // No refresh token or already retried
                await dbService.saveGlobalConfig('dropboxTokens', null);
                throw new Error('Dropboxセッションの有効期限が切れました。設定画面から再接続してください。');
            }

            if (!response.ok) {
                // Handle 409 conflict, etc.
                const errText = await response.text();
                throw new Error(`Dropbox API Error (${response.status}): ${errText}`);
            }

            if (endpoint === '/files/download') return response.blob();

            const text = await response.text();
            return text ? JSON.parse(text) : {};

        } catch (error) {
            throw error;
        }
    },

    // --- High Level Operations ---

    getUserInfo: async () => {
        return dropboxService.request('api', '/users/get_current_account', { method: 'POST' });
    },

    disconnect: async () => {
        try {
            await dropboxService.request('api', '/auth/token/revoke', { method: 'POST' });
        } catch (e) {
            console.warn("Revoke failed, clearing local tokens anyway");
        }
        await dbService.saveGlobalConfig('dropboxTokens', null);
        // Explicitly clear legacy keys if present
        localStorage.removeItem('DROPBOX_ACCESS_TOKEN');
    },

    // --- Sync Logic ---

    // 1. Upload Local Data (Push)
    uploadData: async (data: string) => {
        // Prepare args for Dropbox-API-Arg header. 
        // Note: non-ASCII characters in header might be an issue, but filename is ASCII.
        const args = {
            path: METADATA_PATH,
            mode: 'overwrite',
            mute: true
        };

        await dropboxService.request('content', '/files/upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Dropbox-API-Arg': JSON.stringify(args),
            },
            body: data
        });
    },

    // 2. Download Cloud Data (Pull)
    downloadData: async (): Promise<string | null> => {
        const args = { path: METADATA_PATH };
        try {
            const blob = await dropboxService.request('content', '/files/download', {
                method: 'POST',
                headers: { 'Dropbox-API-Arg': JSON.stringify(args) },
            });
            return await blob.text();
        } catch (e: any) {
            if (e.message && e.message.includes('path/not_found')) {
                return null; // File doesn't exist yet
            }
            throw e;
        }
    },

    // 3. Get Metadata (Timestamp check)
    getMetadata: async (): Promise<any | null> => {
        try {
            return await dropboxService.request('api', '/files/get_metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: METADATA_PATH }),
            });
        } catch (e: any) {
            if (e.message && e.message.includes('path/not_found')) return null;
            throw e;
        }
    },

    // --- Sync Orchestration ---

    createBackupJson: async () => {
        return await dbService.exportAllData();
    },

    restoreBackupJson: async (jsonStr: string) => {
        await dbService.restoreAllData(jsonStr);
    },

    // Main Sync Function
    // returns 'downloaded' if cloud data replaced local, 'uploaded' if local pushed, 'synced' if same
    sync: async (): Promise<'downloaded' | 'uploaded' | 'synced'> => {
        console.log('[Dropbox Sync] Starting sync...');

        const cloudMeta = await dropboxService.getMetadata();
        console.log('[Dropbox Sync] Cloud metadata:', cloudMeta);

        // If no cloud file, push local immediately
        if (!cloudMeta) {
            console.log('[Dropbox Sync] No cloud file found, uploading local data...');
            const localJson = await dropboxService.createBackupJson();
            console.log('[Dropbox Sync] Local backup created, size:', localJson.length, 'bytes');
            await dropboxService.uploadData(localJson);
            console.log('[Dropbox Sync] Upload complete');
            return 'uploaded';
        }

        // Compare timestamps
        const sessions = await dbService.getAllSessions();
        console.log('[Dropbox Sync] Local sessions count:', sessions.length);

        let localLastUpdate = new Date(0);
        if (sessions.length > 0) {
            const sorted = [...sessions].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
            localLastUpdate = sorted[0].updatedAt;
        }
        console.log('[Dropbox Sync] Local last update:', localLastUpdate.toISOString());

        const cloudModifiedTime = new Date(cloudMeta.client_modified);
        console.log('[Dropbox Sync] Cloud modified time:', cloudModifiedTime.toISOString());

        const cloudContentStr = await dropboxService.downloadData();
        if (!cloudContentStr) {
            console.log('[Dropbox Sync] Cloud file empty or could not be downloaded, uploading...');
            const localJson = await dropboxService.createBackupJson();
            await dropboxService.uploadData(localJson);
            return 'uploaded';
        }
        console.log('[Dropbox Sync] Downloaded cloud data, size:', cloudContentStr.length, 'bytes');

        const cloudData = JSON.parse(cloudContentStr);
        // Assuming cloudData structure matches standard format with timestamp
        const cloudTimestamp = new Date(cloudData.timestamp || cloudMeta.client_modified);

        console.log(`[Dropbox Sync] Local latest: ${localLastUpdate.toISOString()}, Cloud timestamp: ${cloudTimestamp.toISOString()}`);

        // Threshold of 1 second differentiation
        if (cloudTimestamp.getTime() > localLastUpdate.getTime() + 1000) {
            console.log("[Dropbox Sync] Cloud is newer. Restoring...");
            await dropboxService.restoreBackupJson(cloudContentStr);
            return 'downloaded';
        } else if (localLastUpdate.getTime() > cloudTimestamp.getTime() + 1000) {
            console.log("[Dropbox Sync] Local is newer. Uploading...");
            const localJson = await dropboxService.createBackupJson();
            await dropboxService.uploadData(localJson);
            return 'uploaded';
        }

        console.log('[Dropbox Sync] Data is already synced');
        return 'synced';
    }
};
