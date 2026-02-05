import React, { Component, ReactNode, useState, useEffect, useRef, useMemo } from 'react';
import { SettingsModal } from './components/SettingsModal';
import { MessageList } from './components/MessageList';
import { HistorySidebar } from './components/HistorySidebar';
import { initializeChat, sendMessageStream } from './services/geminiService';
import { dbService } from './services/db';
import { dropboxService } from './services/dropboxService';
import { ChatConfig, Message, ChatSession, Attachment } from './types';

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false, error: null };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex flex-col items-center justify-center p-4 bg-red-50 text-red-900">
          <h1 className="text-xl font-bold mb-2">エラーが発生しました</h1>
          <p className="text-sm mb-4">アプリの読み込み中に問題が発生しました。</p>
          <pre className="text-xs bg-white p-4 rounded border border-red-200 overflow-auto max-w-full w-full mb-4">
            {this.state.error?.toString()}
          </pre>
          <button
            onClick={() => {
              if (navigator.serviceWorker) {
                navigator.serviceWorker.getRegistrations().then(function (registrations) {
                  for (let registration of registrations) {
                    registration.unregister();
                  }
                });
              }
              localStorage.clear();
              window.location.reload();
            }}
            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-md font-bold"
          >
            キャッシュを削除して再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const DEFAULT_BG_COLOR = '#7297AF';

const DEFAULT_CONFIG: ChatConfig = {
  aiName: 'Gemini',
  aiAvatar: null,
  backgroundImage: null,
  systemInstruction: 'あなたは親切なAIアシスタントです。',
  model: 'gemini-3-flash-preview',
  language: 'ja',
  userName: '',
  userPersona: '',
  relationship: '',
  bubbleOpacity: 1.0,
  backgroundBlur: 0,
  backgroundBrightness: 1.0,
  messageFontSize: 12,
  avatarSize: 40,
  nameFontSize: 12,
  bubbleWidth: 100,
  useGoogleSearch: false,
  useFunctionCalling: false,
  allowUIChange: false,
  forceFunctionCall: false,
  autoScrollToBottom: true,
  sendOnEnter: false,
  responseLength: 'long',
};

// Global type definition for aistudio
declare global {
  interface Window {
    // aistudio is intentionally omitted to avoid type conflict with ambient declarations.
    // We cast window to any when accessing aistudio.
    process?: {
      env: {
        [key: string]: string | undefined;
      }
    }
  }
}

const AppContent: React.FC = () => {
  const [config, setConfig] = useState<ChatConfig>(DEFAULT_CONFIG);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isAppLoading, setIsAppLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [isImmersive, setIsImmersive] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null); // null = checking
  const [dropboxUser, setDropboxUser] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [inputApiKey, setInputApiKey] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  const isLoadedRef = useRef(false);
  const ignoreNextSaveRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check for API Key on mount & Dropbox Auth
  useEffect(() => {
    const checkApiKey = async () => {
      const win = window as any;

      // First check local storage (manual entry)
      const storedKey = localStorage.getItem('GEMINI_API_KEY');
      if (storedKey) {
        console.log('[API Key] Found in localStorage');
        setHasApiKey(true);
        return;
      }

      if (win.aistudio) {
        try {
          const hasKey = await win.aistudio.hasSelectedApiKey();
          console.log('[API Key] aistudio check:', hasKey);
          setHasApiKey(hasKey);
        } catch (e) {
          console.error("Failed to check API key status", e);
          setHasApiKey(false);
        }
      } else {
        // Check if env var is available (for local dev with vite)
        // @ts-ignore
        const envKey = (typeof process !== 'undefined' && process.env?.API_KEY) || (win.process?.env?.API_KEY) || (win.process?.env?.GEMINI_API_KEY);
        console.log('[API Key] env check:', !!envKey);
        if (envKey) {
          setHasApiKey(true);
        } else {
          // No API key found anywhere - show input screen
          console.log('[API Key] No key found, showing input screen');
          setHasApiKey(false);
        }
      }
    };
    checkApiKey();
  }, []);

  const handleSelectKey = async () => {
    const win = window as any;
    if (win.aistudio) {
      try {
        await win.aistudio.openSelectKey();
        // Assume success to avoid race condition
        setHasApiKey(true);
        // Reload page to ensure env vars are fresh if needed, or just proceed
        // window.location.reload(); 
      } catch (e) {
        console.error("Failed to open select key dialog", e);
        alert("APIキーの選択に失敗しました。");
      }
    }
  };

  const handleManualKeySubmit = () => {
    if (!inputApiKey.trim()) return;
    localStorage.setItem('GEMINI_API_KEY', inputApiKey.trim());
    setHasApiKey(true);
    window.location.reload();
  };

  const loadAllData = async () => {
    try {
      if (!dbService) throw new Error("DB Service not available");

      let savedSessions = await dbService.getAllSessions();

      const sorted = savedSessions.sort((a, b) => {
        const timeA = (a.updatedAt instanceof Date ? a.updatedAt : new Date(a.updatedAt)).getTime() || 0;
        const timeB = (b.updatedAt instanceof Date ? b.updatedAt : new Date(b.updatedAt)).getTime() || 0;
        return timeB - timeA;
      });
      setSessions(sorted);

      if (sorted.length > 0) {
        await loadSession(sorted[0].id);
      } else {
        createNewSession(true);
      }
      setIsAppLoading(false);
      isLoadedRef.current = true;
    } catch (e: any) {
      console.error("Failed to load sessions:", e);
      setDbError(e.message || "データベースの読み込みに失敗しました。");
      setIsAppLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      const init = async () => {
        if (navigator.storage && navigator.storage.persist) {
          try {
            await navigator.storage.persist();
          } catch (e) {
            console.warn("Storage persist request failed:", e);
          }
        }
        await loadAllData();

        // Handle Dropbox Auth Callback (PKCE)
        const code = new URLSearchParams(window.location.search).get('code');
        if (code) {
          try {
            const tokens = await dropboxService.handleAuthCallback(code);
            if (tokens) {
              try {
                const account = await dropboxService.getUserInfo();
                setDropboxUser(account.name.display_name);
              } catch (e) { console.warn("Failed to get user info immediately", e); }

              // Auto sync after connecting
              try {
                console.log('[Dropbox] Starting initial sync after connection...');
                const syncResult = await dropboxService.sync();
                console.log('[Dropbox] Initial sync result:', syncResult);

                if (syncResult === 'downloaded') {
                  alert("Dropboxと連携しました！クラウドからデータを復元します。");
                  window.location.href = window.location.pathname; // Reload to apply restored data
                  return;
                } else if (syncResult === 'uploaded') {
                  alert("Dropboxと連携しました！ローカルデータをクラウドにアップロードしました。");
                } else {
                  alert("Dropboxと連携しました！");
                }
              } catch (syncError: any) {
                console.error('[Dropbox] Initial sync failed:', syncError);
                alert("Dropboxと連携しました！（初回同期に失敗: " + syncError.message + "）");
              }

              window.location.href = window.location.pathname; // Clean URL
            }
          } catch (e: any) {
            console.error("Auth callback failed", e);
            alert("認証に失敗しました: " + e.message);
          }
        } else {
          // Check connection on load
          try {
            const isAuth = await dropboxService.isAuthenticated();
            console.log('[Dropbox] isAuthenticated:', isAuth);
            if (isAuth) {
              // Set a default value first to ensure sync button shows
              setDropboxUser('接続済み');

              try {
                const account = await dropboxService.getUserInfo();
                console.log('[Dropbox] User info:', account?.name?.display_name);
                setDropboxUser(account.name.display_name);
              } catch (e) {
                console.log("Failed to fetch user info on load, using default", e);
                // Keep the default "接続済み" value
              }

              // Auto sync on page load if connected
              // Skip if we just reloaded from sync to prevent infinite loop
              const justSynced = sessionStorage.getItem('just_synced');
              if (justSynced) {
                console.log('[Dropbox] Skipping auto-sync (just reloaded from sync)');
                sessionStorage.removeItem('just_synced');
              } else {
                try {
                  console.log('[Dropbox] Starting auto-sync on page load...');
                  const syncResult = await dropboxService.sync();
                  console.log('[Dropbox] Auto-sync result:', syncResult);
                  setLastSyncTime(new Date());

                  if (syncResult === 'downloaded') {
                    // Cloud has newer data, reload to apply
                    console.log('[Dropbox] Cloud data is newer, reloading...');
                    sessionStorage.setItem('just_synced', 'true');
                    window.location.reload();
                    return;
                  }
                } catch (syncError: any) {
                  console.warn('[Dropbox] Auto-sync failed:', syncError);
                  // Don't alert - silently fail for auto-sync
                }
              }
            }
          } catch (e: any) {
            console.log("Dropbox check failed", e);
          }
        }
      };
      window.requestAnimationFrame(() => init());
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const backupRef = useRef(0);

  const performBackup = async (messagesToSave?: Message[]) => {
    try {
      console.log("Running auto-sync...");

      // Force save to DB if messages are provided (Critical for auto-sync consistency)
      if (messagesToSave && currentSessionId) {
        console.log("Force saving session data before sync...");
        await dbService.saveSessionData(currentSessionId, { messages: messagesToSave, config });
        // Update the ref to prevent double-save by the useEffect
        ignoreNextSaveRef.current = true;
      }

      const isAuth = await dropboxService.isAuthenticated();
      if (isAuth) {
        const result = await dropboxService.sync();
        setConfig(prev => ({ ...prev, lastBackupTime: Date.now() }));
        console.log("Auto-sync result:", result);

        if (result === 'downloaded') {
          console.log("New data downloaded from cloud, reloading...");
          window.location.reload();
        }
        return true;
      }
    } catch (e) {
      console.error("Auto-sync failed", e);
    }
    return false;
  };

  // Auto Backup Interval (safety net or time-based if needed, but primarily message based now)
  // We'll keep a long timer just in case, or remove if strictly message based. 
  // User asked for "Instant / 5 / 10 / 30 messages". We will handle that in processMessageSending.
  // We can keep a "heartbeat" backup if interval is 0 (Manual) -> Do nothing.
  // If we wanted time-based, we'd add it here.
  // For now, removing the interval effect.

  useEffect(() => {
    if (isLoadedRef.current) {
      const safeConfig = config || DEFAULT_CONFIG;
      initializeChat(messages, safeConfig.systemInstruction, safeConfig.model, safeConfig.aiAvatar, safeConfig);
    }
  }, [
    config.systemInstruction,
    config.model,
    config.aiAvatar,
    config.aiName,
    config.userName,
    config.userPersona,
    config.relationship,
    config.useGoogleSearch,
    config.useFunctionCalling,
    config.forceFunctionCall,
    config.allowUIChange
  ]);

  const createNewSession = (isFirst = false) => {
    const id = Date.now().toString();

    const newConfig: ChatConfig = isFirst ? DEFAULT_CONFIG : {
      ...DEFAULT_CONFIG,
      // Preserve User Settings and Model
      userName: config.userName,
      userPersona: config.userPersona,
      model: config.model,
      bubbleOpacity: config.bubbleOpacity,
      backgroundBlur: config.backgroundBlur,
      backgroundBrightness: config.backgroundBrightness,
      messageFontSize: config.messageFontSize,
      avatarSize: config.avatarSize,
      nameFontSize: config.nameFontSize,
      bubbleWidth: config.bubbleWidth,
      useGoogleSearch: config.useGoogleSearch,
      useFunctionCalling: config.useFunctionCalling,
      forceFunctionCall: config.forceFunctionCall,
      allowUIChange: config.allowUIChange,

      // Reset Character Settings
      aiName: DEFAULT_CONFIG.aiName,
      aiAvatar: DEFAULT_CONFIG.aiAvatar,
      backgroundImage: DEFAULT_CONFIG.backgroundImage,
      systemInstruction: DEFAULT_CONFIG.systemInstruction,
      relationship: DEFAULT_CONFIG.relationship,
    };

    const newSession: ChatSession = {
      id,
      title: '新しいチャット',
      updatedAt: new Date(),
      preview: '',
      aiName: newConfig.aiName,
      aiAvatar: newConfig.aiAvatar
    };

    const initMsgs: Message[] = isFirst ? [{ id: 'welcome', role: 'model', text: 'こんにちは！何かお手伝いしましょうか？', timestamp: new Date() }] : [];

    setMessages(initMsgs);
    setConfig(newConfig);
    setCurrentSessionId(id);
    setSessions(prev => [newSession, ...prev]);

    dbService.saveSessionIndex(newSession);
    dbService.saveSessionData(id, { messages: initMsgs, config: newConfig });
    ignoreNextSaveRef.current = false;
  };

  const loadSession = async (id: string) => {
    try {
      const data = await dbService.getSessionData(id);
      if (data) {
        ignoreNextSaveRef.current = true;
        setMessages(data.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })));
        setConfig(prev => ({ ...DEFAULT_CONFIG, ...data.config }));
        setCurrentSessionId(id);
      }
    } catch (e) {
      console.error("Failed to load session data:", e);
    }
  };

  const handleRestoreComplete = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    isLoadedRef.current = false;
    setMessages([]);
    setCurrentSessionId('');

    setIsAppLoading(true);
    setTimeout(async () => {
      await loadAllData();
      setIsAppLoading(false);
    }, 500);
  };

  useEffect(() => {
    if (!currentSessionId || !isLoadedRef.current) return;

    if (ignoreNextSaveRef.current) {
      ignoreNextSaveRef.current = false;
      return;
    }

    setSaveStatus('saving');

    const timer = setTimeout(async () => {
      if (sessions.length === 0 && !isAppLoading) {
        return;
      }

      const sessionIndex = sessions.findIndex(s => s.id === currentSessionId);
      if (sessionIndex === -1 && !isAppLoading) {
        return;
      }

      const lastMsg = messages[messages.length - 1];
      const previewText = lastMsg?.text.slice(0, 50) || '';
      const currentSessionFromState = sessions[sessionIndex] || {
        id: currentSessionId,
        title: '新しいチャット',
        updatedAt: new Date(),
        preview: ''
      };

      const updated = {
        ...currentSessionFromState,
        updatedAt: new Date(),
        preview: previewText,
        aiName: config.aiName,
        aiAvatar: config.aiAvatar
      };

      try {
        await dbService.saveSessionIndex(updated);
        await dbService.saveSessionData(currentSessionId, { messages, config });

        if (
          currentSessionFromState.aiName !== config.aiName ||
          currentSessionFromState.aiAvatar !== config.aiAvatar ||
          currentSessionFromState.preview !== previewText
        ) {
          setSessions(prev => prev.map(s => s.id === currentSessionId ? updated : s));
        }

        setSaveStatus('saved');
      } catch (e: any) {
        console.error("Auto save failed:", e);
        setSaveStatus('error');
      }
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [messages, config, sessions, currentSessionId, isAppLoading]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newAttachments: Attachment[] = [];
      const files: File[] = Array.from(e.target.files);

      for (const file of files) {
        try {
          const reader = new FileReader();
          const result = await new Promise<string>((resolve, reject) => {
            reader.onload = (event) => resolve(event.target?.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const [header, base64Data] = result.split(',');
          const mimeType = header.match(/:(.*?);/)?.[1] || file.type;

          newAttachments.push({
            mimeType: mimeType,
            data: base64Data
          });
        } catch (error) {
          console.error("File reading error:", error);
          alert("ファイルの読み込みに失敗しました。");
        }
      }
      setAttachments(prev => [...prev, ...newAttachments]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const processMessageSending = async (text: string, currentHistory: Message[], attachmentsToSend: Attachment[] = []) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const now = Date.now();
    const userId = `${now}-user`;
    const aiId = `${now}-ai`;
    const timestamp = new Date(now);

    const newMessages = [
      ...currentHistory,
      { id: userId, role: 'user', text, timestamp, images: attachmentsToSend } as Message,
      { id: aiId, role: 'model', text: '', timestamp, isThinking: true } as Message
    ];

    setMessages(newMessages);

    // Ensure we are using the latest config
    initializeChat(currentHistory, config.systemInstruction, config.model, config.aiAvatar, config);

    setIsLoading(true);
    let accumulatedText = '';
    try {
      const stream = await sendMessageStream(text, attachmentsToSend, abortController.signal);
      for await (const chunk of stream) {
        if (chunk.text) {
          accumulatedText += chunk.text;
          setMessages(prev => prev.map(m => m.id === aiId ? { ...m, text: accumulatedText, isThinking: false } : m));
        }
        if (chunk.image) {
          setMessages(prev => prev.map(m => m.id === aiId ? { ...m, images: [...(m.images || []), chunk.image!], isThinking: false } : m));
        }
        if (chunk.uiChange && config.allowUIChange) setConfig(prev => ({ ...prev, ...chunk.uiChange }));
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessages(prev => prev.map(m => m.id === aiId ? { ...m, isThinking: false } : m));
      } else {
        console.error("Send message error:", err);
        let errorMsg = "エラーが発生しました。";
        // Check for common API key errors
        // 400 errors are often invalid parameters (like wrong model name), not auth errors.
        if (err.message && (err.message.includes("API key") || err.message.includes("403"))) {
          errorMsg = "APIキーが無効か、設定されていません。再読み込みしてAPIキーを設定してください。";
          setHasApiKey(false); // Force re-check/selection
        }
        setMessages(prev => prev.map(m => m.id === aiId ? { ...m, text: errorMsg, isThinking: false } : m));
        accumulatedText = errorMsg; // Ensure error text is synced if backup happens
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;

      // Handle Auto Backup (Message Count Strategy)
      if (config.autoBackupEnabled && config.autoBackupInterval && config.autoBackupInterval > 0) {
        backupRef.current += 1;
        console.log(`Unsaved messages: ${backupRef.current} / ${config.autoBackupInterval}`);

        if (backupRef.current >= config.autoBackupInterval) {
          // Construct the final message state to pass to backup
          // We need to replicate the last state update logic here to ensure we have the absolute latest
          // However, 'newMessages' variable from closure start is stale.
          // We can use the functional state update outcome? No.
          // Best approach: Reconstruct the final array locally.
          const finalMessages = newMessages.map(m => {
            if (m.id === aiId) {
              // If it was the AI message, it should have the accumulated text
              // Note: accumulatedText is a local variable in this scope, so it IS fresh!
              return { ...m, text: accumulatedText, images: m.images, isThinking: false };
            }
            return m;
          });

          performBackup(finalMessages).then(success => {
            if (success) backupRef.current = 0;
          });
        }
      }
    }
  };

  const handleSend = async () => {
    if ((!inputText.trim() && attachments.length === 0) || isLoading) return;
    const text = inputText;
    const currentAttachments = [...attachments];
    setInputText('');
    setAttachments([]);

    if (editingMessageId) {
      // 編集モード: 対象メッセージより前の履歴を使って再送信
      const targetIndex = messages.findIndex(m => m.id === editingMessageId);
      if (targetIndex >= 0) {
        const truncatedHistory = messages.slice(0, targetIndex);
        setEditingMessageId(null);
        await processMessageSending(text, truncatedHistory, currentAttachments);
        return;
      }
      setEditingMessageId(null);
    }

    await processMessageSending(text, messages, currentAttachments);
  };

  const handleRegenerate = async (id: string) => {
    if (isLoading) return;

    const targetIndex = messages.findIndex(m => m.id === id);
    if (targetIndex <= 0) return;

    const targetMsg = messages[targetIndex];
    if (targetMsg.role !== 'model') return;

    const prevMsg = messages[targetIndex - 1];
    if (prevMsg.role !== 'user') return;

    const truncatedHistory = messages.slice(0, targetIndex - 1);

    await processMessageSending(prevMsg.text, truncatedHistory, prevMsg.images || []);
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleEdit = (id: string, text: string, attachmentsFromMsg?: Attachment[]) => {
    setEditingMessageId(id);
    setInputText(text);
    if (attachmentsFromMsg && attachmentsFromMsg.length > 0) {
      setAttachments(attachmentsFromMsg);
    }
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setInputText('');
    setAttachments([]);
  };

  const backgroundStyle = useMemo(() => {
    const style: React.CSSProperties = {
      backgroundColor: DEFAULT_BG_COLOR,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };

    if (config.backgroundImage) {
      style.backgroundImage = `url("${config.backgroundImage}")`;
    }

    let filters = '';
    if (config.backgroundBlur && config.backgroundBlur > 0) {
      filters += `blur(${config.backgroundBlur}px) `;
    }
    if (config.backgroundBrightness && config.backgroundBrightness !== 1) {
      filters += `brightness(${config.backgroundBrightness})`;
    }
    if (filters) style.filter = filters.trim();

    return style;
  }, [config.backgroundImage, config.backgroundBlur, config.backgroundBrightness]);

  // API Key checking state
  if (hasApiKey === null) {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center bg-gray-50 text-gray-500 font-bold gap-4">
        <div className="w-8 h-8 border-4 border-[#06c755] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm">APIキーを確認中...</p>
      </div>
    );
  }

  if (hasApiKey === false) {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center bg-gray-50 text-gray-600 gap-6 p-6">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center">
          <h2 className="text-2xl font-black text-[#06c755] mb-4">APIキーの設定</h2>
          <p className="text-sm text-gray-500 mb-6 leading-relaxed">
            チャットを開始するには、Google GeminiのAPIキーが必要です。<br />
            下のボタンを押して、APIキーを選択または接続してください。
          </p>
          <button
            onClick={handleSelectKey}
            className="w-full py-4 bg-[#06c755] hover:bg-[#05b34c] text-white rounded-xl font-bold transition-all shadow-md flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
            APIキーを選択・接続する
          </button>
          <div className="mt-6 pt-4 border-t border-gray-100 w-full">
            <p className="text-xs text-center text-gray-500 mb-2">または、APIキーを直接入力</p>
            <div className="flex gap-2">
              <input
                type="password"
                value={inputApiKey}
                onChange={(e) => setInputApiKey(e.target.value)}
                placeholder="Gemini API Key"
                className="flex-1 p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#06c755] focus:ring-1 focus:ring-[#06c755]"
              />
              <button
                onClick={handleManualKeySubmit}
                disabled={!inputApiKey.trim()}
                className="px-4 py-2 bg-gray-800 text-white rounded-lg font-bold text-sm hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                保存
              </button>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-400">
            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#06c755]">
              APIキーと課金についての詳細はこちら
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (isAppLoading) return (
    <div className="h-[100dvh] flex flex-col items-center justify-center bg-gray-50 text-gray-500 font-bold gap-4">
      <div className="w-8 h-8 border-4 border-[#06c755] border-t-transparent rounded-full animate-spin"></div>
      <p className="text-sm">Loading...</p>
    </div>
  );

  if (dbError) {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full">
          <h2 className="text-xl font-black text-red-500 mb-4">エラー</h2>
          <p className="text-sm text-gray-600 mb-6">
            データの読み込みに失敗しました。<br />
            ブラウザの容量制限などの可能性があります。
          </p>
          <p className="text-xs text-gray-400 mb-6 font-mono bg-gray-100 p-2 rounded break-all max-h-32 overflow-y-auto">
            {dbError}
          </p>
          <button
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
            className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold transition-all shadow-md"
          >
            データをリセットして再読み込み
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[100dvh] flex flex-col overflow-hidden">
      <div className="absolute inset-0 z-0 transition-opacity duration-500" style={backgroundStyle} />

      {/* Immersive Mode Overlay (Click to exit) */}
      {isImmersive && (
        <div
          className="absolute inset-0 z-50 cursor-pointer"
          onClick={() => setIsImmersive(false)}
          title="タップしてUIを表示"
        />
      )}

      <header className={`relative z-10 bg-[#2b3542] text-white px-3 py-1 pt-safe flex items-center justify-between shadow-lg flex-shrink-0 transition-all duration-500 ${isImmersive ? 'opacity-0 -translate-y-full pointer-events-none' : 'opacity-100 translate-y-0'}`} style={{ paddingTop: `max(env(safe-area-inset-top, 0px), 0.25rem)` }}>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setIsHistoryOpen(true)} className="p-1.5 hover:bg-white/10 rounded-full">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <span className="font-black truncate max-w-[150px]">{config.aiName}</span>
        </div>
        <div className="flex gap-1 items-center">
          {/* Debug: show dropbox connection state */}
          {console.log('[Render] dropboxUser:', dropboxUser, 'lastSyncTime:', lastSyncTime)}
          {/* Sync button - only show if connected to Dropbox */}
          {dropboxUser && (
            <button
              type="button"
              onClick={async () => {
                if (isSyncing) return;
                setIsSyncing(true);
                try {
                  console.log('[Sync Button] Starting sync...');
                  const result = await dropboxService.sync();
                  console.log('[Sync Button] Sync result:', result);
                  setLastSyncTime(new Date());
                  if (result === 'downloaded') {
                    window.location.reload();
                    return;
                  }
                } catch (e: any) {
                  console.error('[Sync Button] Sync failed:', e);
                  alert('同期に失敗しました:\n' + (e.message || JSON.stringify(e)));
                } finally {
                  setIsSyncing(false);
                }
              }}
              className="flex items-center gap-1 px-2 py-1 hover:bg-white/10 rounded-full text-xs"
              title={lastSyncTime ? `最終同期: ${lastSyncTime.toLocaleTimeString()}` : '同期'}
              disabled={isSyncing}
            >
              {isSyncing ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              {lastSyncTime && (
                <span className="hidden sm:inline text-[10px] opacity-70">
                  {lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsImmersive(true)}
            className="p-1.5 hover:bg-white/10 rounded-full"
            title="背景のみ表示"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          </button>
          <button type="button" onClick={() => setIsSettingsOpen(true)} className="p-1.5 hover:bg-white/10 rounded-full"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg></button>
        </div>
      </header >

      <main className={`flex-1 relative z-10 flex flex-col min-h-0 transition-opacity duration-500 ${isImmersive ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <MessageList
          messages={messages}
          config={config}
          onCopy={(t) => navigator.clipboard.writeText(t)}
          onRegenerate={handleRegenerate}
          onEdit={handleEdit}
        />
      </main>

      <div className={`relative z-20 pointer-events-none flex justify-end px-4 pb-1 transition-opacity duration-500 ${isImmersive ? 'opacity-0' : 'opacity-100'}`}>
        {saveStatus === 'saving' && <span className="text-[10px] text-gray-400 font-bold bg-white/80 px-2 py-0.5 rounded-full shadow-sm">保存中...</span>}
        {saveStatus === 'error' && <span className="text-[10px] text-red-500 font-bold bg-white/90 px-2 py-0.5 rounded-full shadow-sm">保存失敗</span>}
      </div>

      <footer className={`relative z-20 bg-white border-t px-3 py-1 pb-safe flex-shrink-0 transition-all duration-500 ${isImmersive ? 'opacity-0 translate-y-full pointer-events-none' : 'opacity-100 translate-y-0'}`}>
        <div className="max-w-4xl mx-auto flex flex-col gap-2">
          {attachments.length > 0 && (
            <div className="flex gap-2 overflow-x-auto py-2 px-1 scrollbar-hide">
              {attachments.map((att, index) => (
                <div key={index} className="relative group flex-shrink-0">
                  <div className="w-16 h-16 rounded-xl border border-gray-200 overflow-hidden bg-gray-50 flex items-center justify-center">
                    {att.mimeType.startsWith('image/') ? (
                      <img src={'data:' + att.mimeType + ';base64,' + att.data} alt="preview" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-gray-400">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => removeAttachment(index)}
                    className="absolute -top-1.5 -right-1.5 bg-gray-500 text-white rounded-full p-0.5 shadow-md hover:bg-red-500 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-end">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-gray-400 hover:text-[#06c755] hover:bg-gray-100 rounded-2xl transition-colors flex-shrink-0"
              title="ファイルを添付"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              multiple
              onChange={handleFileSelect}
            />

            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (config.sendOnEnter && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (inputText.trim() || attachments.length > 0) {
                    handleSend();
                  }
                }
              }}
              className={'flex-1 rounded-2xl px-3 py-2 focus:outline-none resize-none min-h-[40px] max-h-[120px] transition-all ' +
                (editingMessageId ? 'bg-blue-50 border-2 border-blue-400' : 'bg-gray-100')}
              rows={1}
              placeholder={editingMessageId ? 'メッセージを編集中...' : (config.sendOnEnter ? 'メッセージを入力 (Enterで送信)' : 'メッセージを入力')}
              style={{ height: 'auto', minHeight: '40px' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = Math.min(target.scrollHeight, 120) + 'px';
              }}
            />

            {isLoading ? (
              <button
                type="button"
                onClick={handleStop}
                className="bg-red-500 text-white p-2 rounded-2xl shadow-md hover:bg-red-600 transition-colors flex items-center justify-center w-[40px] h-[40px] flex-shrink-0"
              >
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
              </button>
            ) : editingMessageId ? (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="bg-gray-400 text-white p-2 rounded-2xl shadow-md hover:bg-gray-500 flex items-center justify-center w-[40px] h-[40px] flex-shrink-0 transition-colors"
                  title="編集をキャンセル"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!inputText.trim() && attachments.length === 0}
                  className="bg-blue-500 text-white p-2 rounded-2xl shadow-md disabled:bg-gray-300 flex items-center justify-center w-[40px] h-[40px] flex-shrink-0 transition-colors"
                  title="編集して再送信"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputText.trim() && attachments.length === 0}
                className="bg-[#06c755] text-white p-2 rounded-2xl shadow-md disabled:bg-gray-300 flex items-center justify-center w-[40px] h-[40px] flex-shrink-0 transition-colors"
              >
                <svg className="w-6 h-6 fill-current rotate-90" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
              </button>
            )}
          </div>
          <div className="text-center text-[9px] text-gray-300 mt-1">
            Ver 1.3.10 (2026/02/06 07:46) - Response Length Control
          </div>
        </div>
      </footer>

      <HistorySidebar
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={loadSession}
        onNewChat={() => createNewSession()}
        onDeleteSession={async (id) => {
          await dbService.deleteSessionIndex(id);
          await dbService.deleteSessionData(id);
          loadAllData();
        }}
        onDuplicateSession={async (id) => {
          try {
            // 元のセッションデータを取得
            const sourceData = await dbService.getSessionData(id);
            if (!sourceData) {
              alert('セッションデータが見つかりません');
              return;
            }

            // 新しいIDを生成
            const newId = Date.now().toString();
            const sourceSession = sessions.find(s => s.id === id);

            // 新しいセッションインデックスを作成
            const newSession: ChatSession = {
              id: newId,
              title: sourceSession?.title ? `${sourceSession.title} (コピー)` : '新しいチャット (コピー)',
              updatedAt: new Date(),
              preview: sourceSession?.preview || '',
              aiName: sourceData.config.aiName,
              aiAvatar: sourceData.config.aiAvatar
            };

            // 保存
            await dbService.saveSessionIndex(newSession);
            await dbService.saveSessionData(newId, sourceData);

            // リロードして複製したセッションに切り替え
            await loadAllData();
            loadSession(newId);
            setIsHistoryOpen(false);
          } catch (e: any) {
            console.error('Failed to duplicate session:', e);
            alert('セッションの複製に失敗しました');
          }
        }}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onUpdateConfig={setConfig}
        onRestoreComplete={handleRestoreComplete}
        dropboxUser={dropboxUser}
        setDropboxUser={setDropboxUser}
      />
    </div >
  );
};

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
};

export default App;