
import { ChatSession, SessionData } from '../types';

const DB_NAME = 'AIChatDB';
const DB_VERSION = 17;
const STORE_SESSIONS_INDEX = 'sessions_index';
const STORE_SESSION_DATA = 'session_data';
const STORE_GLOBAL_CONFIG = 'global_config';

let dbPromise: Promise<IDBDatabase> | null = null;

const _wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const _openDB = async (retry = 0): Promise<IDBDatabase> => {
    if (dbPromise) {
        try {
            const db = await dbPromise;
            // @ts-ignore
            if (!db.closed && db.objectStoreNames) return db;
        } catch (e) {
            // retry
        }
        dbPromise = null;
    }

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            console.log("[DB] Upgrade needed.");
            const db = (event.target as IDBOpenDBRequest).result;
            
            if (!db.objectStoreNames.contains(STORE_SESSIONS_INDEX)) {
                db.createObjectStore(STORE_SESSIONS_INDEX, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_SESSION_DATA)) {
                db.createObjectStore(STORE_SESSION_DATA, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_GLOBAL_CONFIG)) {
                db.createObjectStore(STORE_GLOBAL_CONFIG);
            }
        };

        request.onsuccess = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            db.onversionchange = () => {
                console.warn("[DB] Version change detected. Closing connection.");
                db.close();
            };
            db.onclose = () => {
                console.log("[DB] Connection closed.");
                dbPromise = null;
            };
            db.onerror = (e) => {
                console.error("[DB] Database error:", e);
            };
            resolve(db);
        };

        request.onerror = (event) => {
            console.error("[DB] Open Error:", request.error);
            dbPromise = null;
            reject(request.error || new Error("Unknown DB Error"));
        };

        request.onblocked = () => {
            console.warn("[DB] Open Blocked. Please close other tabs.");
        };
    });

    try {
        return await dbPromise;
    } catch (e) {
        if (retry < 3) {
            console.warn(`[DB] Open failed, retrying (${retry + 1}/3)...`);
            await _wait(500);
            return _openDB(retry + 1);
        }
        throw e;
    }
};

const _getTransaction = async (storeNames: string | string[], mode: IDBTransactionMode): Promise<IDBTransaction> => {
    try {
        const db = await _openDB();
        return db.transaction(storeNames, mode);
    } catch (e: any) {
        dbPromise = null;
        console.error("[DB] Transaction creation failed:", e);
        throw e;
    }
};

export const dbService = {
  openDB: () => _openDB(),
  
  // High-performance rescue using keys only to prevent OOM
  rescueOrphanedSessions: async (): Promise<ChatSession[]> => {
      try {
          const db = await _openDB();

          // 1. Get all valid Session IDs from Index (lightweight)
          const indexKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
              const tx = db.transaction(STORE_SESSIONS_INDEX, 'readonly');
              const req = tx.objectStore(STORE_SESSIONS_INDEX).getAllKeys();
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
          });
          const indexKeySet = new Set(indexKeys.map(k => k.toString()));

          // 2. Get all Data IDs (lightweight)
          const dataKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
              const tx = db.transaction(STORE_SESSION_DATA, 'readonly');
              const req = tx.objectStore(STORE_SESSION_DATA).getAllKeys();
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
          });

          // 3. Find orphans
          const missingIds = dataKeys.filter(k => !indexKeySet.has(k.toString()));

          if (missingIds.length === 0) {
              return [];
          }

          console.log(`[DB] Found ${missingIds.length} orphaned sessions. Restoring...`);

          // 4. Restore orphans (Fetch full data only for missing ones)
          const rescuedSessions: ChatSession[] = [];
          
          // Process in small batches or one by one is safest for memory
          // We reuse one transaction for all restorations
          const tx = db.transaction([STORE_SESSIONS_INDEX, STORE_SESSION_DATA], 'readwrite');
          const indexStore = tx.objectStore(STORE_SESSIONS_INDEX);
          const dataStore = tx.objectStore(STORE_SESSION_DATA);

          await new Promise<void>((resolve, reject) => {
              let completed = 0;
              if (missingIds.length === 0) resolve();

              missingIds.forEach(id => {
                  const req = dataStore.get(id);
                  req.onsuccess = () => {
                      const val = req.result;
                      if (val && val.data) {
                          const messages = val.data.messages || [];
                          const lastMsg = messages[messages.length - 1];
                          const config = val.data.config || {};
                          
                          const session: ChatSession = {
                              id: id.toString(),
                              title: config.aiName ? `${config.aiName}とのチャット` : "復元されたチャット",
                              updatedAt: new Date(),
                              preview: lastMsg?.text?.slice(0, 50) || '(データなし)',
                              aiName: config.aiName || 'Gemini',
                              aiAvatar: config.aiAvatar || null
                          };
                          
                          if (messages.length > 0) {
                              const lastTs = new Date(messages[messages.length-1].timestamp);
                              if (!isNaN(lastTs.getTime())) session.updatedAt = lastTs;
                          }
                          
                          indexStore.put(session);
                          rescuedSessions.push(session);
                      }
                      completed++;
                      if (completed === missingIds.length) resolve();
                  };
                  req.onerror = () => {
                      console.error(`Failed to restore session ${id}`);
                      completed++;
                      if (completed === missingIds.length) resolve();
                  };
              });
              tx.onerror = () => reject(tx.error);
          });
          
          return rescuedSessions;
      } catch (e) {
          console.error("[DB] Rescue failed:", e);
          return [];
      }
  },

  getAllSessions: async (): Promise<ChatSession[]> => {
    try {
        const transaction = await _getTransaction([STORE_SESSIONS_INDEX], 'readonly');
        return new Promise((resolve, reject) => {
          const request = transaction.objectStore(STORE_SESSIONS_INDEX).getAll();
          request.onsuccess = () => {
            const results = request.result || [];
            resolve(results.map((s: any) => ({
              ...s,
              updatedAt: new Date(s.updatedAt || Date.now())
            })));
          };
          request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error("[DB] getAllSessions failed:", e);
        throw e;
    }
  },

  saveSessionIndex: async (session: ChatSession): Promise<void> => {
    const transaction = await _getTransaction([STORE_SESSIONS_INDEX], 'readwrite');
    return new Promise((resolve, reject) => {
      transaction.objectStore(STORE_SESSIONS_INDEX).put(session);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  deleteSessionIndex: async (id: string): Promise<void> => {
    const transaction = await _getTransaction([STORE_SESSIONS_INDEX], 'readwrite');
    return new Promise((resolve, reject) => {
      transaction.objectStore(STORE_SESSIONS_INDEX).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  deleteSessionData: async (id: string): Promise<void> => {
    const transaction = await _getTransaction([STORE_SESSION_DATA], 'readwrite');
    return new Promise((resolve, reject) => {
      transaction.objectStore(STORE_SESSION_DATA).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  getSessionData: async (id: string): Promise<SessionData | null> => {
    const transaction = await _getTransaction([STORE_SESSION_DATA], 'readonly');
    return new Promise((resolve, reject) => {
      const request = transaction.objectStore(STORE_SESSION_DATA).get(id);
      request.onsuccess = () => resolve(request.result ? request.result.data : null);
      request.onerror = () => reject(request.error);
    });
  },

  saveSessionData: async (id: string, data: SessionData): Promise<void> => {
    const transaction = await _getTransaction([STORE_SESSION_DATA], 'readwrite');
    return new Promise((resolve, reject) => {
      transaction.objectStore(STORE_SESSION_DATA).put({ id, data });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  getGlobalConfig: async (key: string): Promise<any> => {
    const transaction = await _getTransaction([STORE_GLOBAL_CONFIG], 'readonly');
    return new Promise((resolve, reject) => {
      const request = transaction.objectStore(STORE_GLOBAL_CONFIG).get(key);
      request.onsuccess = () => resolve(request.result === undefined ? null : request.result);
      request.onerror = () => reject(request.error);
    });
  },

  saveGlobalConfig: async (key: string, value: any): Promise<void> => {
    const transaction = await _getTransaction([STORE_GLOBAL_CONFIG], 'readwrite');
    return new Promise((resolve, reject) => {
      if (value === null || value === undefined) {
        transaction.objectStore(STORE_GLOBAL_CONFIG).delete(key);
      } else {
        transaction.objectStore(STORE_GLOBAL_CONFIG).put(value, key);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  getAllSessionDataItems: async (): Promise<{id: string, data: SessionData}[]> => {
    const transaction = await _getTransaction([STORE_SESSION_DATA], 'readonly');
    return new Promise((resolve, reject) => {
      const request = transaction.objectStore(STORE_SESSION_DATA).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  clearAllData: async (): Promise<void> => {
    const transaction = await _getTransaction([STORE_SESSIONS_INDEX, STORE_SESSION_DATA], 'readwrite');
    return new Promise((resolve, reject) => {
      transaction.objectStore(STORE_SESSIONS_INDEX).clear();
      transaction.objectStore(STORE_SESSION_DATA).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  exportAllData: async (): Promise<string> => {
    const sessions = await dbService.getAllSessions();
    const dataItems = await dbService.getAllSessionDataItems();
    
    const backup = {
      version: 1,
      timestamp: new Date().toISOString(),
      sessions,
      dataItems
    };
    return JSON.stringify(backup, null, 2);
  },

  bulkAdd: async (storeName: string, items: any[]): Promise<void> => {
    const transaction = await _getTransaction([storeName], 'readwrite');
    return new Promise((resolve, reject) => {
      const store = transaction.objectStore(storeName);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      for (const item of items) {
        store.put(item);
      }
    });
  },

  restoreAllData: async (data: string | any, onProgress?: (msg: string) => void): Promise<void> => {
    let backup;
    if (onProgress) onProgress("解析中...");
    await _wait(50);

    if (typeof data === 'string') {
        try {
            backup = JSON.parse(data);
        } catch (e) {
            throw new Error("JSONデータの解析に失敗しました。");
        }
    } else {
        backup = data;
    }

    const items = backup.dataItems || backup.sessionDataItems;
    if (!backup.sessions || !items) {
        throw new Error("無効なバックアップデータです。");
    }

    if (onProgress) onProgress("データ消去中...");
    await dbService.clearAllData();
    await _wait(50);

    const sessions = backup.sessions.map((s: any) => ({
        ...s,
        updatedAt: new Date(s.updatedAt)
    }));
    
    // Chunk processing to avoid UI freeze
    const SESSION_BATCH_SIZE = 50; 
    for (let i = 0; i < sessions.length; i += SESSION_BATCH_SIZE) {
        if (onProgress) onProgress(`チャットリスト復元中 (${i + 1}/${sessions.length})`);
        await dbService.bulkAdd(STORE_SESSIONS_INDEX, sessions.slice(i, i + SESSION_BATCH_SIZE));
        await _wait(20);
    }

    const DATA_BATCH_SIZE = 5; 
    for (let i = 0; i < items.length; i += DATA_BATCH_SIZE) {
        if (onProgress) onProgress(`メッセージ履歴復元中 (${i + 1}/${items.length})`);
        const batch = items.slice(i, i + DATA_BATCH_SIZE).map((item: any) => {
            if (item.data && item.data.messages) {
                item.data.messages = item.data.messages.map((m: any) => ({
                    ...m,
                    timestamp: new Date(m.timestamp)
                }));
            }
            return item;
        });
        await dbService.bulkAdd(STORE_SESSION_DATA, batch);
        await _wait(50);
    }

    if (onProgress) onProgress("完了しました！");
  }
};
