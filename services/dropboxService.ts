
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

    // --- Sync Logic ---

    // 1. Upload Local Data (Push)
    uploadData: async (data: string) => {
        // Prepare args for Dropbox-API-Arg header.
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

    // Helper: Merge two backup datasets
    mergeBackups: (local: any, cloud: any): any => {
        console.log('[Dropbox Sync] Merging backups...');

        // Helper to map sessions by ID
        const sessionMap = new Map<string, any>();
        const dataMap = new Map<string, any>();

        // 1. Load Local Data First
        if (local.sessions) {
            local.sessions.forEach((s: any) => sessionMap.set(s.id, s));
        }
        if (local.dataItems || local.sessionDataItems) {
            (local.dataItems || local.sessionDataItems).forEach((d: any) => dataMap.set(d.id, d));
        }

        // 2. Merge Cloud Data
        if (cloud.sessions) {
            cloud.sessions.forEach((cloudSession: any) => {
                const localSession = sessionMap.get(cloudSession.id);
                if (localSession) {
                    // Conflict: Compare updatedAt
                    const localTime = new Date(localSession.updatedAt).getTime();
                    const cloudTime = new Date(cloudSession.updatedAt).getTime();
                    if (cloudTime > localTime) {
                        sessionMap.set(cloudSession.id, cloudSession); // Cloud wins
                    }
                    // Else: Local wins (Keep existing)
                } else {
                    // New from cloud
                    sessionMap.set(cloudSession.id, cloudSession);
                }
            });
        }

        if (cloud.dataItems || cloud.sessionDataItems) {
            (cloud.dataItems || cloud.sessionDataItems).forEach((cloudItem: any) => {
                const localItem = dataMap.get(cloudItem.id);
                // We should respect the session decision ideally, but checking timestamp is safer
                // However, dataItems don't always have simple timestamps at root. 
                // We rely on the fact that if we chose cloud session, we should probably choose cloud data.
                // But let's check the sessionMap source to be consistent.

                const chosenSession = sessionMap.get(cloudItem.id);
                if (chosenSession) {
                    // Check if the chosen session matches the cloud one roughly (update time check)
                    // If sessionMap has the cloud session object, using strictly equal reference might not work due to clone
                    // Let's use ID and updatedAt comparison

                    // Actually, simpler logic:
                    // If local didn't have it, take cloud.
                    // If local had it, check which session version won.
                    if (!localItem) {
                        dataMap.set(cloudItem.id, cloudItem);
                    } else {
                        const winSession = sessionMap.get(cloudItem.id);
                        // If the winning session has the same update time as cloud session, take cloud data
                        // (Assuming cloud sessions loop logic ensures we stored the object from cloud if it won)

                        // To be robust: Compare messages length or last timestamp inside data
                        // Simple approach: Use same logic as Session Index
                        if (cloud.sessions) {
                            const cloudSess = cloud.sessions.find((s: any) => s.id === cloudItem.id);
                            if (cloudSess) {
                                const mergedSess = sessionMap.get(cloudItem.id);
                                if (new Date(cloudSess.updatedAt).getTime() === new Date(mergedSess.updatedAt).getTime()) {
                                    // Cloud session is the winner, so take cloud data
                                    dataMap.set(cloudItem.id, cloudItem);
                                }
                            }
                        }
                    }
                }
            });
        }

        return {
            version: Math.max(local.version || 0, cloud.version || 0),
            timestamp: new Date().toISOString(),
            sessions: Array.from(sessionMap.values()),
            dataItems: Array.from(dataMap.values())
        };
    },

    // Helper: Check if data1 includes everything in data2 (is data1 a superset or equal to data2?)
    // Used to decide if we need to upload/restore
    areBackupsRoughlyEqual: (a: any, b: any): boolean => {
        if (!a || !b) return false;

        // Check sessions count
        if (a.sessions?.length !== b.sessions?.length) return false;

        // Check timestamps matches for all IDs
        const aMap = new Map();
        a.sessions.forEach((s: any) => aMap.set(s.id, s.updatedAt));

        for (const s of (b.sessions || [])) {
            if (!aMap.has(s.id)) return false;
            if (new Date(aMap.get(s.id)).getTime() !== new Date(s.updatedAt).getTime()) return false;
        }

        return true;
    },

    // Main Sync Function
    sync: async (): Promise<'downloaded' | 'uploaded' | 'synced'> => {
        console.log('[Dropbox Sync] Starting sync...');

        const cloudMeta = await dropboxService.getMetadata();

        // 1. Prepare Local Data
        const localJsonStr = await dropboxService.createBackupJson();
        const localData = JSON.parse(localJsonStr);

        // 2. If no cloud data, upload local and finish
        if (!cloudMeta) {
            console.log('[Dropbox Sync] No cloud file found, uploading local data...');
            await dropboxService.uploadData(localJsonStr);
            return 'uploaded';
        }

        // 3. Download Cloud Data
        const cloudContentStr = await dropboxService.downloadData();
        if (!cloudContentStr) {
            console.log('[Dropbox Sync] Failed to download content (empty?), uploading local...');
            await dropboxService.uploadData(localJsonStr);
            return 'uploaded';
        }

        const cloudData = JSON.parse(cloudContentStr);
        console.log(`[Dropbox Sync] Cloud sessions: ${cloudData.sessions?.length}, Local sessions: ${localData.sessions?.length}`);

        // 4. Merge
        const mergedData = dropboxService.mergeBackups(localData, cloudData);
        console.log(`[Dropbox Sync] Merged sessions: ${mergedData.sessions.length}`);

        // 5. Determine Actions
        const isCloudUpToDate = dropboxService.areBackupsRoughlyEqual(cloudData, mergedData);
        const isLocalUpToDate = dropboxService.areBackupsRoughlyEqual(localData, mergedData);

        console.log(`[Dropbox Sync] Cloud up-to-date: ${isCloudUpToDate}, Local up-to-date: ${isLocalUpToDate}`);

        if (isCloudUpToDate && isLocalUpToDate) {
            return 'synced';
        }

        // Upload to Cloud if needed
        if (!isCloudUpToDate) {
            console.log('[Dropbox Sync] Uploading merged data to cloud...');
            await dropboxService.uploadData(JSON.stringify(mergedData));
        }

        // Restore to Local if needed
        if (!isLocalUpToDate) {
            console.log('[Dropbox Sync] Restoring merged data to local...');
            await dropboxService.restoreBackupJson(JSON.stringify(mergedData));
            return 'downloaded'; // This triggers reload in App.tsx
        }

        return 'uploaded'; // Only cloud was updated
    }
};
