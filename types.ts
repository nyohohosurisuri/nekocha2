
export interface Attachment {
  mimeType: string;
  data: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  isThinking?: boolean;
  images?: Attachment[];
}

export interface StreamChunk {
  text?: string;
  image?: Attachment;
  uiChange?: UIChangeResult;
}

export interface ChatConfig {
  aiName: string;
  aiAvatar: string | null;
  backgroundImage: string | null;
  systemInstruction: string;
  model: string;
  language?: string; // 'ja' | 'en' | 'ko' | 'zh-TW' | 'zh-CN'
  responseLength?: 'short' | 'normal' | 'long'; // New: Short, Normal, Long (None)
  // User Profile
  userName?: string;
  userPersona?: string;
  relationship?: string;
  // UI Customization
  backgroundBlur?: number;
  backgroundBrightness?: number;
  bubbleOpacity?: number;
  messageFontSize?: number;
  avatarSize?: number;
  nameFontSize?: number;
  bubbleWidth?: number;
  // Gemini Tool Flags
  useGoogleSearch?: boolean;
  useFunctionCalling?: boolean;
  allowUIChange?: boolean;
  forceFunctionCall?: boolean;
  // Cloud Sync Config
  syncProvider?: 'dropbox' | 'googledrive';
  googleDriveClientId?: string;
  dropboxAppKey?: string;
  autoBackupEnabled?: boolean;
  autoBackupInterval?: number; // 0: Manual, 1: Immediate, 5/10/30: Messages
  messageCountSinceLastBackup?: number;
  lastBackupTime?: number;
  // Behavior
  autoScrollToBottom?: boolean;
  sendOnEnter?: boolean;
  // Emoji-TTS / Irodori-TTS integration
  ttsEnabled?: boolean;
  ttsAutoPlay?: boolean;
  ttsServerUrl?: string;
  ttsCheckpoint?: string;
  ttsLoraAdapter?: string;
  ttsLoraScale?: number;
  ttsMultilineMode?: string;
  ttsSilenceSec?: number;
  ttsNumSteps?: number;
  ttsSeed?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: Date;
  preview: string;
  aiAvatar?: string | null;
  aiName?: string;
}

export interface SessionData {
  messages: Message[];
  config: ChatConfig;
}

export interface UIChangeResult {
  bubbleOpacity?: number;
  backgroundImage?: string;
}

export interface PromptPreset {
  id: string;
  title: string;
  filename: string;
  description: string;
}

export interface DropboxTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  account_id: string;
  uid: string;
  scope: string;
  token_type: string;
}

export interface DropboxSettings {
  autoSync?: boolean;
  [key: string]: any;
}

export interface GoogleDriveTokens {
  access_token: string;
  expires_at: number;
  scope: string;
  token_type: string;
}
