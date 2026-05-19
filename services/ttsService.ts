export const DEFAULT_TTS_SERVER_URL = 'http://127.0.0.1:7862';

export interface TTSOptions {
  api_version?: number;
  checkpoints: string[];
  default_checkpoint: string;
  lora_adapters: string[];
  default_lora_adapter: string;
  multiline_modes: string[];
  default_multiline_mode: string;
  default_num_steps: number;
  default_silence_sec: number;
  lan_urls?: string[];
}

export interface TTSGenerateRequest {
  serverUrl?: string;
  text: string;
  checkpoint?: string;
  loraAdapter?: string;
  loraScale?: number;
  multilineMode?: string;
  silenceSec?: number;
  numSteps?: number;
  seed?: string;
}

export interface TTSGenerateResult {
  audioUrl: string;
  audioPath?: string;
  caption?: string;
  detail?: string;
  timing?: string;
}

const normalizeServerUrl = (serverUrl?: string): string => {
  const raw = (serverUrl || DEFAULT_TTS_SERVER_URL).trim().replace(/\/+$/, '');
  return raw || DEFAULT_TTS_SERVER_URL;
};

const isPrivateIpv4Host = (host: string): boolean => {
  return /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
};

const isHttpsPageWithPrivateHttpServer = (serverUrl: string): boolean => {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return false;
  try {
    const parsed = new URL(serverUrl);
    return parsed.protocol === 'http:' && isPrivateIpv4Host(parsed.hostname);
  } catch {
    return false;
  }
};

const connectionErrorMessage = (serverUrl: string): string => {
  if (isHttpsPageWithPrivateHttpServer(serverUrl)) {
    return 'iPhone Safariでは公開URL(HTTPS)からPC内のEmoji-TTS(HTTP)へ接続できない場合があります。PCでローカル確認用URLを起動し、iPhoneでは http://PCのIP:4173 を開いてください。';
  }
  return 'Emoji-TTSに接続できませんでした。Emoji-TTSを起動してから更新してください。';
};

const parseSseCompleteData = (body: string): any[] => {
  let currentEvent = '';
  let currentData: string[] = [];
  let completeData = '';

  const flush = () => {
    if (currentEvent === 'complete') {
      completeData = currentData.join('\n');
    }
    if (currentEvent === 'error') {
      throw new Error(currentData.join('\n') || 'Emoji-TTSでエラーが発生しました。');
    }
    currentEvent = '';
    currentData = [];
  };

  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      if (currentEvent || currentData.length > 0) flush();
      currentEvent = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      currentData.push(line.slice('data:'.length).trimStart());
    } else if (line.trim() === '') {
      if (currentEvent || currentData.length > 0) flush();
    }
  }
  if (currentEvent || currentData.length > 0) flush();

  if (!completeData) {
    throw new Error('Emoji-TTSから完了データが返りませんでした。');
  }

  return JSON.parse(completeData);
};

const callGradioApi = async (serverUrl: string, apiName: string, data: any[]): Promise<any[]> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  let startResponse: Response;
  try {
    startResponse = await fetch(`${baseUrl}/gradio_api/call/${apiName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
  } catch {
    throw new Error(connectionErrorMessage(baseUrl));
  }

  if (!startResponse.ok) {
    throw new Error(`Emoji-TTS APIを開始できませんでした (${startResponse.status})。`);
  }

  const startPayload = await startResponse.json();
  const eventId = startPayload?.event_id;
  if (!eventId) {
    throw new Error('Emoji-TTS APIのイベントIDが取得できませんでした。');
  }

  let resultResponse: Response;
  try {
    resultResponse = await fetch(`${baseUrl}/gradio_api/call/${apiName}/${eventId}`);
  } catch {
    throw new Error(connectionErrorMessage(baseUrl));
  }
  if (!resultResponse.ok) {
    throw new Error(`Emoji-TTS APIの結果取得に失敗しました (${resultResponse.status})。`);
  }

  return parseSseCompleteData(await resultResponse.text());
};

const resolveAudioUrl = (serverUrl: string, audioValue: any): string => {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (typeof audioValue === 'string' && audioValue.trim()) {
    return audioValue.startsWith('http') ? audioValue : new URL(audioValue, `${baseUrl}/`).toString();
  }
  if (audioValue?.url) {
    return String(audioValue.url).startsWith('http')
      ? String(audioValue.url)
      : new URL(audioValue.url, `${baseUrl}/`).toString();
  }
  throw new Error('Emoji-TTSの音声URLが取得できませんでした。');
};

export const ttsService = {
  getOptions: async (serverUrl?: string): Promise<TTSOptions> => {
    const data = await callGradioApi(normalizeServerUrl(serverUrl), 'nekocha_tts_options', []);
    return data[0] as TTSOptions;
  },

  generate: async (request: TTSGenerateRequest): Promise<TTSGenerateResult> => {
    const serverUrl = normalizeServerUrl(request.serverUrl);
    const data = await callGradioApi(serverUrl, 'nekocha_tts_generate', [
      request.text,
      request.checkpoint || '',
      request.loraAdapter || '（なし）',
      request.loraScale ?? 1.0,
      request.multilineMode || 'デフォルト',
      request.silenceSec ?? 0.1,
      request.numSteps ?? 40,
      request.seed || '',
    ]);

    const audioValue = data[0];
    const meta = data[1] || {};

    return {
      audioUrl: resolveAudioUrl(serverUrl, audioValue),
      audioPath: meta.audio_path || audioValue?.path,
      caption: meta.caption,
      detail: meta.detail,
      timing: meta.timing,
    };
  },
};
