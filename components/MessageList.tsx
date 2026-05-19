import React, { useEffect, useRef, useState } from 'react';
import { Message, ChatConfig } from '../types';

interface MessageListProps {
  messages: Message[];
  config: ChatConfig;
  onCopy?: (text: string) => void;
  onRegenerate?: (id: string) => void;
  onEdit?: (id: string, text: string, attachments?: any[]) => void;
  onSpeak?: (id: string, text: string) => void;
  ttsAudioUrls?: Record<string, string>;
  ttsGeneratingMessageId?: string | null;
}

// 翻訳キャッシュ
const translationCache: Record<string, string> = {};

export const MessageList: React.FC<MessageListProps> = ({ messages, config, onCopy, onRegenerate, onEdit, onSpeak, ttsAudioUrls = {}, ttsGeneratingMessageId }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  // 翻訳表示モード: 'original' | 'translated'
  const [translationMode, setTranslationMode] = useState<Record<string, 'original' | 'translated'>>({});
  // 翻訳中のメッセージID
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  // スクロール位置追跡: 'top' | 'middle' | 'bottom'
  const [scrollPosition, setScrollPosition] = useState<'top' | 'middle' | 'bottom'>('bottom');

  // スクロール位置を監視
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const scrollThreshold = 100; // px

      if (scrollTop < scrollThreshold) {
        setScrollPosition('top');
      } else if (scrollTop + clientHeight >= scrollHeight - scrollThreshold) {
        setScrollPosition('bottom');
      } else {
        setScrollPosition('middle');
      }
    };

    container.addEventListener('scroll', handleScroll);
    // 初期状態をチェック
    handleScroll();

    return () => container.removeEventListener('scroll', handleScroll);
  }, [messages]);

  // 最上部へスクロール
  const scrollToTop = () => {
    topRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 最下部へスクロール
  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (config.autoScrollToBottom !== false) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, config.autoScrollToBottom]);

  useEffect(() => {
    const handleClickOutside = () => setActiveMessageId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleBubbleClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setActiveMessageId(prev => prev === id ? null : id);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // テキスト内の *太字* または **太字** を解析して表示する関数
  const formatMessageText = (text: string) => {
    if (!text) return null;

    // **で囲まれた部分または*で囲まれた部分を分割する正規表現
    // 優先度: ** > * (長いマッチを先に処理)
    const parts = text.split(/(\*\*.*?\*\*|\*[^*]+?\*)/g);

    return parts.map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        // **を取り除いて太字にする
        return <strong key={index} className="font-bold">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length >= 2 && !part.startsWith('**')) {
        // *を取り除いて太字にする
        return <strong key={index} className="font-bold">{part.slice(1, -1)}</strong>;
      }
      return <span key={index}>{part}</span>;
    });
  };

  // 翻訳処理
  const handleTranslate = async (msgId: string, text: string) => {
    // キャッシュがあれば即座に表示
    if (translationCache[msgId]) {
      setTranslationMode(prev => ({ ...prev, [msgId]: 'translated' }));
      return;
    }

    setTranslatingId(msgId);

    try {
      // APIキーを取得
      const apiKey = localStorage.getItem('GEMINI_API_KEY');
      if (!apiKey) {
        alert('APIキーが設定されていません');
        setTranslatingId(null);
        return;
      }

      const prompt = `あなたは外国語学習アシスタントです。以下の文章を分析してください。

【原文】
${text}

【タスク】
1. まず原文の言語を判定してください
2. 日本語以外の言語の場合のみ、以下の形式で翻訳と解説を提供してください

【出力形式】
原文が日本語の場合:
「この文章は日本語です。翻訳の必要はありません。」とだけ出力してください。

原文が日本語以外の場合:
## 🌐 翻訳
（原文を自然な日本語に翻訳）

## 📚 単語・表現
（原文に含まれる重要な単語や表現を3〜5個、その意味を日本語で解説）

## 📝 文法メモ
（【重要】ここでは原文の言語の文法を解説してください。翻訳後の日本語の文法ではありません。
例えば原文が英語なら英語の文法を、韓国語なら韓国語の文法を日本語で解説してください。
学習に役立つ文法ポイントを1〜2個、具体的に説明してください。）

注意: 文法メモは必ず原文の言語の文法について解説すること。日本語訳の文法ではない。`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        }
      );

      const data = await response.json();
      const translation = data.candidates?.[0]?.content?.parts?.[0]?.text || '翻訳に失敗しました';

      // キャッシュに保存
      translationCache[msgId] = translation;
      setTranslationMode(prev => ({ ...prev, [msgId]: 'translated' }));
    } catch (error) {
      console.error('Translation error:', error);
      alert('翻訳に失敗しました');
    } finally {
      setTranslatingId(null);
    }
  };

  // 原文に戻す
  const handleShowOriginal = (msgId: string) => {
    setTranslationMode(prev => ({ ...prev, [msgId]: 'original' }));
  };

  const avatarSize = config.avatarSize || 40;
  const nameFontSize = config.nameFontSize || 12;
  const messageFontSize = config.messageFontSize || 12;
  const bubbleWidth = config.bubbleWidth || 100;
  const bubbleOpacity = config.bubbleOpacity || 1.0;

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 relative">
      <div ref={topRef} />
      {messages.map((msg) => {
        const isUser = msg.role === 'user';
        const isActive = activeMessageId === msg.id;
        const currentMode = translationMode[msg.id] || 'original';
        const isTranslating = translatingId === msg.id;
        const hasTranslation = !!translationCache[msg.id];

        // 表示するテキストを決定
        const displayText = currentMode === 'translated' && hasTranslation
          ? translationCache[msg.id]
          : msg.text;

        return (
          <div key={msg.id} className={'flex w-full ' + (isUser ? 'justify-end' : 'justify-start')}>
            <div
              className={'flex items-start gap-2 ' + (isUser ? 'flex-row-reverse' : 'flex-row')}
              style={{ maxWidth: bubbleWidth + '%' }}
            >
              {!isUser && (
                <div
                  className="rounded-full bg-white border overflow-hidden flex-shrink-0 mt-1 shadow-sm"
                  style={{ width: avatarSize + 'px', height: avatarSize + 'px' }}
                >
                  {config.aiAvatar ? (
                    <img src={config.aiAvatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-[#06c755] text-white font-black" style={{ fontSize: (avatarSize / 2) + 'px' }}>
                      {config.aiName[0]}
                    </div>
                  )}
                </div>
              )}

              <div className={'flex flex-col min-w-0 ' + (isUser ? 'items-end' : 'items-start')}>
                {!isUser && (
                  <span
                    className="text-white drop-shadow-md mb-1 ml-1 font-black truncate max-w-full"
                    style={{ fontSize: nameFontSize + 'px' }}
                  >
                    {config.aiName}
                  </span>
                )}

                <div className="flex flex-col">
                  <div className="flex items-end gap-1 max-w-full">
                    {isUser && <span className="text-[10px] text-white/80 mb-1 flex-shrink-0">{formatTime(msg.timestamp)}</span>}

                    <div
                      onClick={(e) => handleBubbleClick(e, msg.id)}
                      className={'px-4 py-2 rounded-2xl shadow-sm relative transition-all cursor-pointer ' +
                        (isUser ? 'bg-[#8DE055] rounded-tr-none text-gray-800' : 'bg-white rounded-tl-none text-gray-800') +
                        (isActive ? ' ring-2 ring-blue-400 ring-offset-2 ring-offset-transparent' : '')}
                      style={{
                        opacity: bubbleOpacity,
                        fontSize: messageFontSize + 'px'
                      }}
                    >
                      {msg.isThinking || isTranslating ? (
                        <div className="flex gap-1 py-2">
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                        </div>
                      ) : (
                        <>
                          {displayText && (
                            <div className="whitespace-pre-wrap break-words leading-relaxed">
                              {formatMessageText(displayText)}
                            </div>
                          )}

                          {msg.images && msg.images.length > 0 && (
                            <div className={'space-y-2 ' + (msg.text ? 'mt-3 pt-2 border-t border-gray-100/50' : '')}>
                              {msg.images.map((img, i) => (
                                <div key={i}>
                                  {img.mimeType.startsWith('image/') ? (
                                    <img
                                      src={'data:' + img.mimeType + ';base64,' + img.data}
                                      className="rounded-xl max-w-full shadow-sm border border-gray-100"
                                      alt="attachment"
                                    />
                                  ) : (
                                    <div className="flex items-center gap-3 p-3 bg-gray-50/80 rounded-xl border border-gray-200 shadow-sm">
                                      <div className="p-2 bg-gray-200 rounded-lg flex-shrink-0 text-gray-500">
                                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-gray-700 truncate">添付ファイル</p>
                                        <p className="text-[10px] text-gray-500 truncate font-mono">{img.mimeType}</p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {!isUser && <span className="text-[10px] text-white/80 mb-1 flex-shrink-0">{formatTime(msg.timestamp)}</span>}
                  </div>

                  {isActive && !msg.isThinking && !isTranslating && (
                    <div className={'mt-2 flex gap-2 animate-fade-in flex-wrap ' + (isUser ? 'justify-end' : 'justify-start')}>
                      {onCopy && msg.text && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onCopy(currentMode === 'translated' && hasTranslation ? translationCache[msg.id] : msg.text); setActiveMessageId(null); }}
                          className="bg-white text-gray-600 text-xs px-3 py-1.5 rounded-full shadow-lg font-bold hover:bg-gray-50 flex items-center gap-1 active:scale-95 transition-transform"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                          コピー
                        </button>
                      )}

                      {isUser && onEdit && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onEdit(msg.id, msg.text, msg.images); setActiveMessageId(null); }}
                          className="bg-blue-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg font-bold hover:bg-blue-600 flex items-center gap-1 active:scale-95 transition-transform"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          編集
                        </button>
                      )}

                      {!isUser && onRegenerate && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onRegenerate(msg.id); setActiveMessageId(null); }}
                          className="bg-blue-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg font-bold hover:bg-blue-600 flex items-center gap-1 active:scale-95 transition-transform"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                          再生成
                        </button>
                      )}

                      {!isUser && msg.text && onSpeak && config.ttsEnabled && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onSpeak(msg.id, msg.text); setActiveMessageId(null); }}
                          disabled={ttsGeneratingMessageId === msg.id}
                          className="bg-amber-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg font-bold hover:bg-amber-600 flex items-center gap-1 active:scale-95 transition-transform disabled:opacity-60 disabled:active:scale-100"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H3v6h3l5 4V5zm4.5 3.5a5 5 0 010 7m2.5-9.5a8 8 0 010 11" />
                          </svg>
                          {ttsGeneratingMessageId === msg.id ? '生成中' : (ttsAudioUrls[msg.id] ? '再生' : '音声')}
                        </button>
                      )}

                      {/* 翻訳/原文ボタン - AIメッセージのみ */}
                      {!isUser && msg.text && (
                        currentMode === 'original' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleTranslate(msg.id, msg.text); }}
                            className="bg-purple-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg font-bold hover:bg-purple-600 flex items-center gap-1 active:scale-95 transition-transform"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>
                            翻訳
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleShowOriginal(msg.id); }}
                            className="bg-gray-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg font-bold hover:bg-gray-600 flex items-center gap-1 active:scale-95 transition-transform"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                            原文
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />

      {/* フローティングスクロールボタン - 1つのボタンで上下切り替え */}
      {messages.length > 0 && (
        <button
          onClick={scrollPosition === 'bottom' ? scrollToTop : scrollToBottom}
          className="fixed right-4 bottom-24 z-30 bg-white/90 hover:bg-white text-gray-700 p-3 rounded-full shadow-lg transition-all duration-300 hover:scale-110 active:scale-95 backdrop-blur-sm border border-gray-200"
          title={scrollPosition === 'bottom' ? '最上部へ' : '最下部へ'}
        >
          {scrollPosition === 'bottom' ? (
            // 上矢印アイコン
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          ) : (
            // 下矢印アイコン
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
};
