
import { dbService } from './db';

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_FILE_NAME = 'ai-chat-auto-sync-v1.json';

let cachedAccessToken: string | null = null;

export const googleDriveService = {
    // Generate backup JSON string
    createBackupJson: async () => {
        const sessions = await dbService.getAllSessions();
        const sessionDataItems = await dbService.getAllSessionDataItems();
        const presets = localStorage.getItem('chat_prompt_presets');
        
        const backupData = {
            version: 1,
            timestamp: new Date().toISOString(),
            sessions: sessions,
            sessionDataItems: sessionDataItems,
            localStorage: {
                presets: presets ? JSON.parse(presets) : []
            }
        };
        return JSON.stringify(backupData);
    },

    // Get valid Access Token via Popup
    getAccessToken: async (clientId: string): Promise<string> => {
        if (cachedAccessToken) return cachedAccessToken;

        return new Promise((resolve, reject) => {
            const win = window as any;
            if (!win.google) return reject(new Error("Google Identity Services not loaded"));

            const tokenClient = win.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: SCOPES,
                callback: (response: any) => {
                    if (response.error) return reject(response);
                    cachedAccessToken = response.access_token;
                    resolve(response.access_token);
                },
            });
            tokenClient.requestAccessToken({ prompt: cachedAccessToken ? '' : 'consent' });
        });
    },

    // Find our specific backup file
    findBackupFile: async (token: string): Promise<string | null> => {
        const q = encodeURIComponent(`name = '${BACKUP_FILE_NAME}' and trashed = false`);
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        return data.files && data.files.length > 0 ? data.files[0].id : null;
    },

    // Push local data to Drive
    pushData: async (clientId: string): Promise<void> => {
        try {
            const token = await googleDriveService.getAccessToken(clientId);
            const fileId = await googleDriveService.findBackupFile(token);
            const content = await googleDriveService.createBackupJson();
            
            if (fileId) {
                // Update existing
                await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: content
                });
            } else {
                // Create new
                const metadata = { name: BACKUP_FILE_NAME, mimeType: 'application/json' };
                const form = new FormData();
                form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                form.append('file', new Blob([content], { type: 'application/json' }));
                
                await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: form
                });
            }
        } catch (e) {
            console.error("[Drive Sync Push] Failed", e);
            throw e;
        }
    },

    // Pull data from Drive and merge
    pullData: async (clientId: string): Promise<boolean> => {
        try {
            const token = await googleDriveService.getAccessToken(clientId);
            const fileId = await googleDriveService.findBackupFile(token);
            if (!fileId) return false;

            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const backup = await res.json();

            if (!backup || !backup.sessions) return false;

            // Simple timestamp check: only sync if cloud is newer
            const cloudTime = new Date(backup.timestamp).getTime();
            const localSessions = await dbService.getAllSessions();
            const localTime = localSessions.length > 0 
                ? Math.max(...localSessions.map(s => new Date(s.updatedAt).getTime())) 
                : 0;

            if (cloudTime <= localTime) return false;

            // Apply backup to IndexedDB
            await dbService.clearAllData();
            for (const session of backup.sessions) {
                session.updatedAt = new Date(session.updatedAt);
                await dbService.saveSessionIndex(session);
            }
            for (const item of backup.sessionDataItems) {
                if (item.data && item.data.messages) {
                    item.data.messages = item.data.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
                }
                await dbService.saveSessionData(item.id, item.data);
            }
            if (backup.localStorage?.presets) localStorage.setItem('chat_prompt_presets', JSON.stringify(backup.localStorage.presets));
            
            return true;
        } catch (e) {
            console.error("[Drive Sync Pull] Failed", e);
            return false;
        }
    }
};
