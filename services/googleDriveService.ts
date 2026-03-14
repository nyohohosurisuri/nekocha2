
import { dbService } from './db';
import { GoogleDriveTokens, ChatSession, SessionData } from '../types';

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_FILE_NAME = 'nekocha_backup.json';

// --- Version Info ---
const SERVICE_VERSION = '1.1.0';
const SERVICE_UPDATED = '2026-02-13';

export const googleDriveService = {

    // --- Auth Flow (OAuth 2.0 Implicit Grant - Redirect) ---
    // Works on all platforms including iOS Safari

    generateAuthUrl: (clientId: string): string => {
        const redirectUri = googleDriveService.getCurrentRedirectUri();
        // Store clientId for use after redirect
        localStorage.setItem('gdrive_client_id', clientId);

        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'token',
            scope: SCOPES,
            include_granted_scopes: 'true',
            prompt: 'consent',
        });

        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    },

    getCurrentRedirectUri: (): string => {
        return window.location.origin + window.location.pathname;
    },

    // Handle the OAuth redirect callback (token in URL hash)
    handleAuthCallback: async (): Promise<GoogleDriveTokens | null> => {
        const hash = window.location.hash;
        if (!hash || !hash.includes('access_token')) return null;

        const params = new URLSearchParams(hash.substring(1)); // Remove #
        const accessToken = params.get('access_token');
        const expiresIn = params.get('expires_in');
        const tokenType = params.get('token_type');
        const scope = params.get('scope');

        if (!accessToken) return null;

        const tokens: GoogleDriveTokens = {
            access_token: accessToken,
            expires_at: Date.now() + (parseInt(expiresIn || '3600') - 60) * 1000,
            scope: scope || SCOPES,
            token_type: tokenType || 'Bearer',
        };

        // Persist tokens
        await dbService.saveGlobalConfig('googleDriveTokens', tokens);

        // Clean URL hash
        window.history.replaceState(null, '', window.location.pathname + window.location.search);

        return tokens;
    },

    // Get a valid access token (from cache)
    getAccessToken: async (): Promise<string> => {
        const cached = await googleDriveService.getTokens();
        if (cached && Date.now() < cached.expires_at) {
            return cached.access_token;
        }
        throw new Error('Google Driveセッションの有効期限が切れました。設定画面から再接続してください。');
    },

    // Re-authenticate via redirect (for token refresh)
    reAuthenticate: (clientId?: string): void => {
        const cid = clientId || localStorage.getItem('gdrive_client_id');
        if (!cid) {
            throw new Error('Client IDが設定されていません。');
        }
        const authUrl = googleDriveService.generateAuthUrl(cid);
        window.location.href = authUrl;
    },

    // --- Token Management ---

    getTokens: async (): Promise<GoogleDriveTokens | null> => {
        return await dbService.getGlobalConfig('googleDriveTokens');
    },

    isAuthenticated: async (): Promise<boolean> => {
        const tokens = await dbService.getGlobalConfig('googleDriveTokens');
        return !!tokens && Date.now() < tokens.expires_at;
    },

    // --- API Request Wrapper ---

    request: async (url: string, options: RequestInit = {}, retryCount = 0): Promise<Response> => {
        const token = await googleDriveService.getAccessToken();

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${token}`,
            ...(options.headers as Record<string, string> || {}),
        };

        const response = await fetch(url, { ...options, headers });

        if (response.status === 401) {
            console.warn('[Google Drive] 401 Unauthorized - token expired');
            await dbService.saveGlobalConfig('googleDriveTokens', null);
            throw new Error('Google Driveセッションの有効期限が切れました。設定画面から再接続してください。');
        }

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Google Drive API Error (${response.status}): ${errText}`);
        }

        return response;
    },

    // --- High Level Operations ---

    getUserInfo: async (): Promise<{ name: string; email: string }> => {
        const token = await googleDriveService.getAccessToken();
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('ユーザー情報の取得に失敗しました');
        const data = await res.json();
        return { name: data.name || data.email, email: data.email };
    },

    disconnect: async () => {
        const tokens = await googleDriveService.getTokens();
        if (tokens?.access_token) {
            try {
                await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                });
            } catch (e) {
                console.warn("[Google Drive] Token revoke failed, clearing local tokens anyway");
            }
        }
        await dbService.saveGlobalConfig('googleDriveTokens', null);
        localStorage.removeItem('gdrive_client_id');
    },

    // --- File Operations ---

    findBackupFile: async (): Promise<string | null> => {
        const q = encodeURIComponent(`name = '${BACKUP_FILE_NAME}' and trashed = false`);
        const res = await googleDriveService.request(
            `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`
        );
        const data = await res.json();
        return data.files && data.files.length > 0 ? data.files[0].id : null;
    },

    getMetadata: async (): Promise<{ id: string; modifiedTime: string } | null> => {
        const q = encodeURIComponent(`name = '${BACKUP_FILE_NAME}' and trashed = false`);
        const res = await googleDriveService.request(
            `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`
        );
        const data = await res.json();
        if (data.files && data.files.length > 0) {
            return { id: data.files[0].id, modifiedTime: data.files[0].modifiedTime };
        }
        return null;
    },

    // Upload
    uploadData: async (data: string) => {
        const fileId = await googleDriveService.findBackupFile();

        if (fileId) {
            await googleDriveService.request(
                `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: data
                }
            );
        } else {
            const metadata = { name: BACKUP_FILE_NAME, mimeType: 'application/json' };
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', new Blob([data], { type: 'application/json' }));

            const token = await googleDriveService.getAccessToken();
            const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: form
            });
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Google Drive Upload Error (${res.status}): ${errText}`);
            }
        }
    },

    // Download
    downloadData: async (): Promise<string | null> => {
        const fileId = await googleDriveService.findBackupFile();
        if (!fileId) return null;

        const res = await googleDriveService.request(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
        );
        return await res.text();
    },

    // --- Sync Orchestration ---

    createBackupJson: async () => {
        return await dbService.exportAllData();
    },

    restoreBackupJson: async (jsonStr: string) => {
        await dbService.restoreAllData(jsonStr);
    },

    // Merge logic (same as Dropbox)
    mergeBackups: (local: any, cloud: any): any => {
        console.log('[Google Drive Sync] Merging backups...');

        const sessionMap = new Map<string, any>();
        const dataMap = new Map<string, any>();

        if (local.sessions) {
            local.sessions.forEach((s: any) => sessionMap.set(s.id, s));
        }
        if (local.dataItems || local.sessionDataItems) {
            (local.dataItems || local.sessionDataItems).forEach((d: any) => dataMap.set(d.id, d));
        }

        if (cloud.sessions) {
            cloud.sessions.forEach((cloudSession: any) => {
                const localSession = sessionMap.get(cloudSession.id);
                if (localSession) {
                    const localTime = new Date(localSession.updatedAt).getTime();
                    const cloudTime = new Date(cloudSession.updatedAt).getTime();
                    if (cloudTime > localTime) {
                        sessionMap.set(cloudSession.id, cloudSession);
                    }
                } else {
                    sessionMap.set(cloudSession.id, cloudSession);
                }
            });
        }

        if (cloud.dataItems || cloud.sessionDataItems) {
            (cloud.dataItems || cloud.sessionDataItems).forEach((cloudItem: any) => {
                const localItem = dataMap.get(cloudItem.id);
                if (!localItem) {
                    dataMap.set(cloudItem.id, cloudItem);
                } else {
                    if (cloud.sessions) {
                        const cloudSess = cloud.sessions.find((s: any) => s.id === cloudItem.id);
                        if (cloudSess) {
                            const mergedSess = sessionMap.get(cloudItem.id);
                            if (new Date(cloudSess.updatedAt).getTime() === new Date(mergedSess.updatedAt).getTime()) {
                                dataMap.set(cloudItem.id, cloudItem);
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

    areBackupsRoughlyEqual: (a: any, b: any): boolean => {
        if (!a || !b) return false;
        if (a.sessions?.length !== b.sessions?.length) return false;

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
        console.log('[Google Drive Sync] Starting sync...');

        const metadata = await googleDriveService.getMetadata();
        const localJsonStr = await googleDriveService.createBackupJson();
        const localData = JSON.parse(localJsonStr);

        if (!metadata) {
            console.log('[Google Drive Sync] No cloud file found, uploading local data...');
            await googleDriveService.uploadData(localJsonStr);
            return 'uploaded';
        }

        const cloudContentStr = await googleDriveService.downloadData();
        if (!cloudContentStr) {
            console.log('[Google Drive Sync] Failed to download content, uploading local...');
            await googleDriveService.uploadData(localJsonStr);
            return 'uploaded';
        }

        const cloudData = JSON.parse(cloudContentStr);
        console.log(`[Google Drive Sync] Cloud sessions: ${cloudData.sessions?.length}, Local sessions: ${localData.sessions?.length}`);

        const mergedData = googleDriveService.mergeBackups(localData, cloudData);
        console.log(`[Google Drive Sync] Merged sessions: ${mergedData.sessions.length}`);

        const isCloudUpToDate = googleDriveService.areBackupsRoughlyEqual(cloudData, mergedData);
        const isLocalUpToDate = googleDriveService.areBackupsRoughlyEqual(localData, mergedData);

        console.log(`[Google Drive Sync] Cloud up-to-date: ${isCloudUpToDate}, Local up-to-date: ${isLocalUpToDate}`);

        if (isCloudUpToDate && isLocalUpToDate) {
            return 'synced';
        }

        if (!isCloudUpToDate) {
            console.log('[Google Drive Sync] Uploading merged data to cloud...');
            await googleDriveService.uploadData(JSON.stringify(mergedData));
        }

        if (!isLocalUpToDate) {
            console.log('[Google Drive Sync] Restoring merged data to local...');
            await googleDriveService.restoreBackupJson(JSON.stringify(mergedData));
            return 'downloaded';
        }

        return 'uploaded';
    }
};
