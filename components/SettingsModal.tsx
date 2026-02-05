import React, { useRef, useState, useEffect } from 'react';
import { ChatConfig, PromptPreset } from '../types';
import { dbService } from '../services/db';
import { dropboxService } from '../services/dropboxService';
import { ImageCropper } from './ImageCropper';
import { ImageUrlInput } from './ImageUrlInput';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    config: ChatConfig;
    onUpdateConfig: (updateFn: (prev: ChatConfig) => ChatConfig) => void;
    onRestoreComplete: () => void;
    dropboxUser: string | null;
    setDropboxUser: (user: string | null) => void;
}

type TabType = 'basic' | 'user' | 'character' | 'appearance' | 'tools' | 'advanced' | 'system' | 'backup';

const TAB_LABELS: Record<TabType, string> = {
    basic: '基本',
    user: 'ユーザー',
    character: 'キャラ',
    appearance: '表示',
    tools: 'ツール',
    advanced: '詳細',
    system: 'データ',
    backup: 'クラウド'
};

const MODEL_OPTIONS = [
    { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (Preview)' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
    { value: 'gemini-3-flash-thinking-exp', label: 'Gemini 3 Flash Thinking (Exp)' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, config, onUpdateConfig, onRestoreComplete, dropboxUser, setDropboxUser }) => {
    const [activeTab, setActiveTab] = useState<TabType>('basic');
    const [presets, setPresets] = useState<PromptPreset[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processStatus, setProcessStatus] = useState("");
    const [isRestoring, setIsRestoring] = useState(false);
    const [restoreStatus, setRestoreStatus] = useState<string>("");
    const [cropperImage, setCropperImage] = useState<string | null>(null);
    const [urlInputTarget, setUrlInputTarget] = useState<'aiAvatar' | 'backgroundImage' | null>(null);

    const avatarRef = useRef<HTMLInputElement>(null);
    const bgRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    useEffect(() => {
        fetch('./presets/manifest.json')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) setPresets(data);
            })
            .catch(err => console.error("Failed to load presets", err));
    }, []);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, key: keyof ChatConfig) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // For avatar images, show the cropper
        if (key === 'aiAvatar') {
            const reader = new FileReader();
            reader.onload = (event) => {
                setCropperImage(event.target?.result as string);
            };
            reader.readAsDataURL(file);
            if (e.target) e.target.value = '';
            return;
        }

        // For other images (background), process directly
        setIsProcessing(true);
        setProcessStatus("画像を処理中...");

        try {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const MAX_SIZE = 1200;

                    if (width > height) {
                        if (width > MAX_SIZE) {
                            height *= MAX_SIZE / width;
                            width = MAX_SIZE;
                        }
                    } else {
                        if (height > MAX_SIZE) {
                            width *= MAX_SIZE / height;
                            height = MAX_SIZE;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, width, height);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

                        onUpdateConfig(prev => ({ ...prev, [key]: dataUrl }));
                        setProcessStatus("完了");
                        setTimeout(() => setIsProcessing(false), 500);
                    }
                };
                img.src = event.target?.result as string;
            };
            reader.readAsDataURL(file);
        } catch (error) {
            alert("画像の処理に失敗しました。");
            setIsProcessing(false);
        } finally {
            if (e.target) e.target.value = '';
        }
    };

    const handleCropComplete = (croppedDataUrl: string) => {
        onUpdateConfig(prev => ({ ...prev, aiAvatar: croppedDataUrl }));
        setCropperImage(null);
    };

    const handleResetImage = (key: keyof ChatConfig) => {
        if (confirm("画像をリセットしますか？")) {
            onUpdateConfig(prev => ({ ...prev, [key]: null }));
        }
    };

    const handleExport = async () => {
        try {
            const json = await dbService.exportAllData();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            alert('バックアップの作成に失敗しました。');
        }
    };

    const processRestore = async (file: File) => {
        try {
            setIsRestoring(true);
            setRestoreStatus("読み込み中...");
            await new Promise(resolve => setTimeout(resolve, 100));

            const text = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target?.result as string);
                reader.onerror = () => reject(new Error("読み込み失敗"));
                reader.readAsText(file);
            });

            const startIdx = text.indexOf('{');
            const endIdx = text.lastIndexOf('}');
            if (startIdx === -1 || endIdx === -1) throw new Error("無効なファイルです");
            const jsonContent = text.substring(startIdx, endIdx + 1);

            await dbService.restoreAllData(jsonContent, (msg) => setRestoreStatus(msg));
            onRestoreComplete();
            alert("復元が完了しました");
        } catch (err: any) {
            alert("復元失敗: " + err.message);
        } finally {
            setIsRestoring(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (confirm("現在のデータを上書きして復元しますか？\n(現在のデータは消えます)")) processRestore(file);
        else e.target.value = '';
    };

    const handleRescue = async () => {
        if (!confirm("履歴一覧に表示されないチャットデータを検索し、復元を試みます。\n実行しますか？")) return;

        setIsProcessing(true);
        setProcessStatus("データを検査中...");

        try {
            const rescued = await dbService.rescueOrphanedSessions();
            if (rescued.length > 0) {
                alert(`${rescued.length}件のチャットを復元しました。`);
                onRestoreComplete();
            } else {
                alert("復元が必要なデータは見つかりませんでした。");
                setIsProcessing(false);
            }
        } catch (e) {
            alert("エラーが発生しました。");
            setIsProcessing(false);
        }
    };

    const handleDeleteAll = async () => {
        const confirmText = "すべてのチャット履歴と設定を削除します。\n本当によろしいですか？";
        if (!confirm(confirmText)) return;
        if (!confirm("本当に削除します。元に戻せません。\nよろしいですか？")) return;

        try {
            await dbService.clearAllData();
            onRestoreComplete();
            alert("全データを削除しました。");
        } catch (e) {
            alert("削除に失敗しました。");
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-white sm:bg-black/50 sm:flex sm:items-center sm:justify-center transition-opacity duration-200">

            <div className="w-full h-full sm:w-[600px] sm:h-[80vh] bg-white sm:rounded-xl sm:shadow-2xl flex flex-col overflow-hidden">

                <div className="flex-none h-14 border-b flex items-center justify-between px-4 bg-white z-10 pt-safe" style={{ paddingTop: `max(env(safe-area-inset-top, 0px), 0px)`, minHeight: 'calc(3.5rem + env(safe-area-inset-top, 0px))' }}>
                    <h2 className="font-bold text-lg text-gray-800">設定</h2>
                    <button
                        onClick={onClose}
                        className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                    >
                        <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {(isProcessing || isRestoring) && (
                    <div className="absolute inset-0 z-50 bg-white/90 flex flex-col items-center justify-center">
                        <div className="w-8 h-8 border-4 border-[#06c755] border-t-transparent rounded-full animate-spin mb-3"></div>
                        <p className="text-sm font-bold text-gray-600">{isRestoring ? restoreStatus : processStatus}</p>
                    </div>
                )}

                <div className="flex-none bg-gray-50 border-b border-gray-200">
                    <div className="flex overflow-x-auto px-2 pt-2 pb-0 scrollbar-hide space-x-1">
                        {(Object.keys(TAB_LABELS) as TabType[]).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={'flex-none px-4 py-2 text-sm font-bold rounded-t-lg transition-colors border-b-2 ' +
                                    (activeTab === tab
                                        ? 'bg-white text-[#06c755] border-[#06c755]'
                                        : 'text-gray-500 hover:text-gray-700 border-transparent hover:bg-gray-100')
                                }
                            >
                                {TAB_LABELS[tab]}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50/30 overscroll-contain">

                    {activeTab === 'basic' && (
                        <div className="space-y-6 max-w-lg mx-auto animate-fade-in">
                            <div className="space-y-4">
                                <label className="block text-sm font-bold text-gray-700">AIの名前</label>
                                <input
                                    type="text"
                                    value={config.aiName}
                                    onChange={(e) => onUpdateConfig(prev => ({ ...prev, aiName: e.target.value }))}
                                    className="w-full p-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#06c755] focus:border-transparent outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white p-4 rounded-xl border border-gray-200 flex flex-col items-center">
                                    <span className="text-xs font-bold text-gray-500 mb-2">アイコン</span>
                                    <div className="w-20 h-20 rounded-full bg-gray-100 border border-gray-200 overflow-hidden mb-3 relative">
                                        {config.aiAvatar ? (
                                            <img src={config.aiAvatar} className="w-full h-full object-cover" alt="Avatar" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-2 w-full">
                                        <button onClick={() => avatarRef.current?.click()} className="flex-1 text-xs bg-white border border-gray-300 hover:bg-gray-50 px-2 py-1.5 rounded-lg font-bold text-gray-600 transition-colors">画像</button>
                                        <button onClick={() => setUrlInputTarget('aiAvatar')} className="flex-1 text-xs bg-blue-50 border border-blue-200 hover:bg-blue-100 px-2 py-1.5 rounded-lg font-bold text-blue-600 transition-colors">検索</button>
                                        {config.aiAvatar && (
                                            <button onClick={() => handleResetImage('aiAvatar')} className="text-xs bg-white border border-red-200 hover:bg-red-50 px-2 py-1.5 rounded-lg font-bold text-red-500 transition-colors">×</button>
                                        )}
                                    </div>
                                    <input type="file" ref={avatarRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'aiAvatar')} />
                                </div>

                                <div className="bg-white p-4 rounded-xl border border-gray-200 flex flex-col items-center">
                                    <span className="text-xs font-bold text-gray-500 mb-2">背景画像</span>
                                    <div className="w-full h-20 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden mb-3 relative">
                                        {config.backgroundImage ? (
                                            <img src={config.backgroundImage} className="w-full h-full object-cover" alt="BG" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-2 w-full">
                                        <button onClick={() => bgRef.current?.click()} className="flex-1 text-xs bg-white border border-gray-300 hover:bg-gray-50 px-2 py-1.5 rounded-lg font-bold text-gray-600 transition-colors">画像</button>
                                        <button onClick={() => setUrlInputTarget('backgroundImage')} className="flex-1 text-xs bg-blue-50 border border-blue-200 hover:bg-blue-100 px-2 py-1.5 rounded-lg font-bold text-blue-600 transition-colors">検索</button>
                                        {config.backgroundImage && (
                                            <button onClick={() => handleResetImage('backgroundImage')} className="text-xs bg-white border border-red-200 hover:bg-red-50 px-2 py-1.5 rounded-lg font-bold text-red-500 transition-colors">×</button>
                                        )}
                                    </div>
                                    <input type="file" ref={bgRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'backgroundImage')} />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-sm font-bold text-gray-700">言語</label>
                                <div className="relative">
                                    <select
                                        value={config.language || 'ja'}
                                        onChange={(e) => onUpdateConfig(prev => ({ ...prev, language: e.target.value }))}
                                        className="w-full p-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#06c755] focus:border-transparent outline-none appearance-none"
                                    >
                                        <option value="ja">なし (日本語)</option>
                                        <option value="en">English</option>
                                        <option value="ko">한국어</option>
                                        <option value="zh-TW">繁體中文</option>
                                        <option value="zh-CN">简体中文</option>
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                    </div>
                                </div>
                                <p className="text-xs text-gray-400 ml-1">キャラクターがこの言語で話します</p>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-sm font-bold text-gray-700">メッセージの長さ</label>
                                <div className="relative">
                                    <select
                                        value={config.responseLength || 'long'}
                                        onChange={(e) => onUpdateConfig(prev => ({ ...prev, responseLength: e.target.value as any }))}
                                        className="w-full p-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#06c755] focus:border-transparent outline-none appearance-none"
                                    >
                                        <option value="short">短い</option>
                                        <option value="normal">普通</option>
                                        <option value="long">長い (指定なし)</option>
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                    </div>
                                </div>
                                <p className="text-xs text-gray-400 ml-1">AIの返答の長さを調整します</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'user' && (
                        <div className="space-y-4 max-w-lg mx-auto animate-fade-in">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">あなたの名前</label>
                                <input
                                    type="text"
                                    value={config.userName || ''}
                                    onChange={(e) => onUpdateConfig(prev => ({ ...prev, userName: e.target.value }))}
                                    className="w-full p-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#06c755] focus:border-transparent outline-none"
                                    placeholder="AIに呼ばれたい名前"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">あなたの設定 (Persona)</label>
                                <textarea
                                    value={config.userPersona || ''}
                                    onChange={(e) => onUpdateConfig(prev => ({ ...prev, userPersona: e.target.value }))}
                                    className="w-full p-3 bg-white border border-gray-300 rounded-xl h-24 resize-none focus:ring-2 focus:ring-[#06c755] focus:border-transparent outline-none"
                                    placeholder="例: 30代の会社員、趣味は映画鑑賞..."
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">AIとの関係性</label>
                                <input
                                    type="text"
                                    value={config.relationship || ''}
                                    onChange={(e) => onUpdateConfig(prev => ({ ...prev, relationship: e.target.value }))}
                                    className="w-full p-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#06c755] focus:border-transparent outline-none"
                                    placeholder="例: 幼馴染、先生と生徒、良きパートナー..."
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'character' && (
                        <div className="space-y-6 max-w-lg mx-auto animate-fade-in">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">使用モデル</label>
                                    <div className="relative mb-2">
                                        <select
                                            value={MODEL_OPTIONS.some(o => o.value === config.model) ? config.model : 'custom'}
                                            onChange={(e) => {
                                                if (e.target.value !== 'custom') {
                                                    onUpdateConfig(prev => ({ ...prev, model: e.target.value }));
                                                }
                                            }}
                                            className="w-full p-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#06c755] focus:border-transparent outline-none appearance-none font-medium"
                                        >
                                            {MODEL_OPTIONS.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                            <option value="custom">カスタム (手動入力)</option>
                                        </select>
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                        </div>
                                    </div>

                                    {(!MODEL_OPTIONS.some(o => o.value === config.model) || config.model === 'custom') && (
                                        <input
                                            type="text"
                                            value={config.model}
                                            onChange={(e) => onUpdateConfig(prev => ({ ...prev, model: e.target.value }))}
                                            placeholder="モデルIDを入力 (例: gemini-pro)"
                                            className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#06c755] focus:border-transparent outline-none text-sm font-mono"
                                        />
                                    )}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">システムプロンプト (性格設定)</label>
                                    <textarea
                                        value={config.systemInstruction}
                                        onChange={(e) => onUpdateConfig(prev => ({ ...prev, systemInstruction: e.target.value }))}
                                        className="w-full p-4 bg-white border border-gray-300 rounded-xl h-48 resize-none focus:ring-2 focus:ring-[#06c755] focus:border-transparent outline-none font-mono text-sm leading-relaxed"
                                        placeholder="AIの性格や口調を自由に設定..."
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-2 ml-1">プリセットから選ぶ</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {presets.map(p => (
                                        <button
                                            key={p.id}
                                            onClick={() => {
                                                fetch(`./presets/${p.filename}`).then(r => r.text()).then(t => {
                                                    onUpdateConfig(prev => ({ ...prev, aiName: p.title, systemInstruction: t }));
                                                    alert(`${p.title} の設定を適用しました`);
                                                });
                                            }}
                                            className="p-3 bg-white border border-gray-200 rounded-xl text-left hover:border-[#06c755] transition-all active:bg-gray-50 shadow-sm"
                                        >
                                            <div className="font-bold text-sm text-gray-800">{p.title}</div>
                                            <div className="text-xs text-gray-400 truncate mt-0.5">{p.description}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'appearance' && (
                        <div className="space-y-6 max-w-lg mx-auto animate-fade-in">
                            <div className="bg-white p-5 rounded-xl border border-gray-200 space-y-6">
                                <div>
                                    <div className="flex justify-between mb-1">
                                        <label className="text-xs font-bold text-gray-500">吹き出しの透明度</label>
                                        <span className="text-xs font-mono text-gray-400">{Math.round((config.bubbleOpacity ?? 1) * 100)}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0.1"
                                        max="1"
                                        step="0.05"
                                        value={config.bubbleOpacity ?? 1}
                                        onChange={(e) => onUpdateConfig(prev => ({ ...prev, bubbleOpacity: parseFloat(e.target.value) }))}
                                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#06c755]"
                                    />
                                </div>

                                <div>
                                    <div className="flex justify-between mb-1">
                                        <label className="text-xs font-bold text-gray-500">背景のぼかし</label>
                                        <span className="text-xs font-mono text-gray-400">{config.backgroundBlur ?? 0}px</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="20"
                                        step="1"
                                        value={config.backgroundBlur ?? 0}
                                        onChange={(e) => onUpdateConfig(prev => ({ ...prev, backgroundBlur: parseInt(e.target.value) }))}
                                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#06c755]"
                                    />
                                </div>

                                <div>
                                    <div className="flex justify-between mb-1">
                                        <label className="text-xs font-bold text-gray-500">背景の明るさ</label>
                                        <span className="text-xs font-mono text-gray-400">{Math.round((config.backgroundBrightness ?? 1) * 100)}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0.1"
                                        max="1.5"
                                        step="0.1"
                                        value={config.backgroundBrightness ?? 1}
                                        onChange={(e) => onUpdateConfig(prev => ({ ...prev, backgroundBrightness: parseFloat(e.target.value) }))}
                                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#06c755]"
                                    />
                                </div>
                            </div>

                            <div className="bg-white p-5 rounded-xl border border-gray-200 space-y-6">
                                <div>
                                    <div className="flex justify-between mb-1">
                                        <label className="text-xs font-bold text-gray-500">文字サイズ (メッセージ)</label>
                                        <span className="text-xs font-mono text-gray-400">{config.messageFontSize ?? 12}px</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="10"
                                        max="30"
                                        step="1"
                                        value={config.messageFontSize ?? 12}
                                        onChange={(e) => onUpdateConfig(prev => ({ ...prev, messageFontSize: parseInt(e.target.value) }))}
                                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#06c755]"
                                    />
                                </div>
                                <div>
                                    <div className="flex justify-between mb-1">
                                        <label className="text-xs font-bold text-gray-500">文字サイズ (名前)</label>
                                        <span className="text-xs font-mono text-gray-400">{config.nameFontSize ?? 12}px</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="8"
                                        max="20"
                                        step="1"
                                        value={config.nameFontSize ?? 12}
                                        onChange={(e) => onUpdateConfig(prev => ({ ...prev, nameFontSize: parseInt(e.target.value) }))}
                                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#06c755]"
                                    />
                                </div>
                                <div>
                                    <div className="flex justify-between mb-1">
                                        <label className="text-xs font-bold text-gray-500">アイコンサイズ</label>
                                        <span className="text-xs font-mono text-gray-400">{config.avatarSize ?? 40}px</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="20"
                                        max="80"
                                        step="2"
                                        value={config.avatarSize ?? 40}
                                        onChange={(e) => onUpdateConfig(prev => ({ ...prev, avatarSize: parseInt(e.target.value) }))}
                                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#06c755]"
                                    />
                                </div>
                                <div>
                                    <div className="flex justify-between mb-1">
                                        <label className="text-xs font-bold text-gray-500">吹き出しの幅 (最大)</label>
                                        <span className="text-xs font-mono text-gray-400">{config.bubbleWidth ?? 100}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="50"
                                        max="100"
                                        step="5"
                                        value={config.bubbleWidth ?? 100}
                                        onChange={(e) => onUpdateConfig(prev => ({ ...prev, bubbleWidth: parseInt(e.target.value) }))}
                                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#06c755]"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'tools' && (
                        <div className="space-y-4 max-w-lg mx-auto animate-fade-in">
                            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <label className="flex items-center justify-between cursor-pointer">
                                    <div>
                                        <div className="font-bold text-sm text-gray-800">Google検索 (Grounding)</div>
                                        <div className="text-xs text-gray-500 mt-0.5">最新情報を検索して回答に反映します</div>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={config.useGoogleSearch || false}
                                            onChange={(e) => onUpdateConfig(prev => ({ ...prev, useGoogleSearch: e.target.checked }))}
                                        />
                                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#06c755]"></div>
                                    </div>
                                </label>
                            </div>

                            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <label className="flex items-center justify-between cursor-pointer">
                                    <div>
                                        <div className="font-bold text-sm text-gray-800">機能呼び出し (Function Calling)</div>
                                        <div className="text-xs text-gray-500 mt-0.5">画像生成やUI操作を可能にします</div>
                                        <div className="text-[10px] text-orange-500 mt-0.5">※Google検索と同時には使用できません</div>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={config.useFunctionCalling || false}
                                            onChange={(e) => onUpdateConfig(prev => ({ ...prev, useFunctionCalling: e.target.checked }))}
                                        />
                                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#06c755]"></div>
                                    </div>
                                </label>

                                {config.useFunctionCalling && (
                                    <div className="mt-4 pt-4 border-t border-gray-100 space-y-3 pl-2">
                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 text-[#06c755] rounded focus:ring-[#06c755]"
                                                checked={config.allowUIChange || false}
                                                onChange={(e) => onUpdateConfig(prev => ({ ...prev, allowUIChange: e.target.checked }))}
                                            />
                                            <span className="text-sm text-gray-700">AIによるUI操作を許可 (背景変更など)</span>
                                        </label>
                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 text-[#06c755] rounded focus:ring-[#06c755]"
                                                checked={config.forceFunctionCall || false}
                                                onChange={(e) => onUpdateConfig(prev => ({ ...prev, forceFunctionCall: e.target.checked }))}
                                            />
                                            <span className="text-sm text-gray-700">ツール使用を強制 (デバッグ用)</span>
                                        </label>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'advanced' && (
                        <div className="space-y-4 max-w-lg mx-auto animate-fade-in">
                            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <label className="flex items-center justify-between cursor-pointer">
                                    <div>
                                        <div className="font-bold text-sm text-gray-800">メッセージ更新時に自動スクロール</div>
                                        <div className="text-xs text-gray-500 mt-0.5">新しいメッセージが来ると最下部へスクロールします</div>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={config.autoScrollToBottom !== false}
                                            onChange={(e) => onUpdateConfig(prev => ({ ...prev, autoScrollToBottom: e.target.checked }))}
                                        />
                                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#06c755]"></div>
                                    </div>
                                </label>
                            </div>

                            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <label className="flex items-center justify-between cursor-pointer">
                                    <div>
                                        <div className="font-bold text-sm text-gray-800">Enterキーで送信</div>
                                        <div className="text-xs text-gray-500 mt-0.5">Enterキーでメッセージを送信します（改行はShift+Enter）</div>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={config.sendOnEnter || false}
                                            onChange={(e) => onUpdateConfig(prev => ({ ...prev, sendOnEnter: e.target.checked }))}
                                        />
                                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#06c755]"></div>
                                    </div>
                                </label>
                            </div>
                        </div>
                    )}

                    {activeTab === 'system' && (
                        <div className="space-y-4 max-w-lg mx-auto animate-fade-in">
                            <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                                <h3 className="font-bold text-sm text-blue-800 mb-2">バックアップと復元</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={handleExport}
                                        className="py-2.5 bg-white border border-blue-200 text-blue-600 rounded-lg font-bold text-xs hover:bg-blue-50 transition-colors shadow-sm"
                                    >
                                        データを保存 (JSON)
                                    </button>
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="py-2.5 bg-blue-500 text-white rounded-lg font-bold text-xs hover:bg-blue-600 transition-colors shadow-sm"
                                    >
                                        データから復元
                                    </button>
                                </div>
                                <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleImport} />
                            </div>

                            <div className="p-4 bg-orange-50 rounded-xl border border-orange-100">
                                <h3 className="font-bold text-sm text-orange-800 mb-2">トラブルシューティング</h3>
                                <button
                                    onClick={handleRescue}
                                    className="w-full py-2.5 bg-white border border-orange-200 text-orange-600 rounded-lg font-bold text-xs hover:bg-orange-50 transition-colors shadow-sm"
                                >
                                    消えたチャット履歴を救出する
                                </button>
                                <p className="text-[10px] text-orange-400 mt-2">
                                    ※履歴一覧に表示されないデータを検索し、復旧を試みます。
                                </p>
                            </div>

                            <div className="p-4 bg-red-50 rounded-xl border border-red-100 mt-8">
                                <h3 className="font-bold text-sm text-red-800 mb-2">危険な操作</h3>
                                <button
                                    onClick={handleDeleteAll}
                                    className="w-full py-2.5 bg-white border border-red-200 text-red-600 rounded-lg font-bold text-xs hover:bg-red-50 transition-colors shadow-sm"
                                >
                                    全てのデータを削除する
                                </button>
                                <p className="text-[10px] text-red-400 mt-2">
                                    ※この操作は取り消せません。すべてのチャット履歴と設定が削除されます。
                                </p>
                            </div>

                            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 mt-8">
                                <h3 className="font-bold text-sm text-gray-800 mb-3 flex items-center gap-2">
                                    <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                                    APIキー設定
                                </h3>
                                <div className="space-y-3">
                                    <div className="text-xs text-gray-500">
                                        {localStorage.getItem('GEMINI_API_KEY') ? (
                                            <div className="flex items-center gap-2 text-green-600">
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                                APIキーが設定されています
                                            </div>
                                        ) : (
                                            <span className="text-orange-500">APIキーが設定されていません</span>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            type="password"
                                            placeholder="新しいAPIキーを入力..."
                                            id="modal-api-key-input"
                                            className="flex-1 p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#06c755] focus:ring-1 focus:ring-[#06c755]"
                                        />
                                        <button
                                            onClick={() => {
                                                const input = document.getElementById('modal-api-key-input') as HTMLInputElement;
                                                const newKey = input?.value?.trim();
                                                if (newKey) {
                                                    localStorage.setItem('GEMINI_API_KEY', newKey);
                                                    alert('APIキーを保存しました。');
                                                    input.value = '';
                                                    window.location.reload();
                                                } else {
                                                    alert('APIキーを入力してください。');
                                                }
                                            }}
                                            className="px-4 py-2 bg-[#06c755] text-white rounded-lg font-bold text-xs hover:bg-[#05b34c] transition-colors"
                                        >
                                            保存
                                        </button>
                                    </div>
                                    {localStorage.getItem('GEMINI_API_KEY') && (
                                        <button
                                            onClick={() => {
                                                if (confirm('APIキーを削除しますか？')) {
                                                    localStorage.removeItem('GEMINI_API_KEY');
                                                    alert('APIキーを削除しました。');
                                                    window.location.reload();
                                                }
                                            }}
                                            className="text-xs text-red-500 hover:text-red-600 underline"
                                        >
                                            APIキーを削除
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'backup' && (
                        <div className="space-y-6 max-w-lg mx-auto animate-fade-in">
                            <div className="bg-white p-5 rounded-xl border border-gray-200">
                                <h3 className="font-bold text-base text-gray-800 mb-4 flex items-center gap-2">
                                    <svg className="w-5 h-5 text-[#0061FE]" fill="currentColor" viewBox="0 0 24 24"><path d="M6 3l-6 4.5 6 4.5 6-4.5-6-4.5zm12 0l-6 4.5 6 4.5 6-4.5-6-4.5zm-12 18l-6-4.5 5.25-3.938 6.75 5.063-6 3.375zm12 0l-6-3.375 6.75-5.063 5.25 3.938-6 4.5zm-6-6.375l-5.625-4.219-5.625 4.219-6-4.5 11.625-8.625 11.625 8.625-6 4.5-5.625-4.219-5.625 4.219z" /></svg>
                                    データ同期 (Smart Sync)
                                </h3>

                                <div className="space-y-4">
                                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 mb-4">
                                        <label className="block text-xs font-bold text-gray-500 mb-1">セッションの自動同期のタイミング:</label>
                                        <select
                                            value={config.autoBackupInterval && config.autoBackupEnabled ? config.autoBackupInterval : 0}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                onUpdateConfig(prev => ({
                                                    ...prev,
                                                    autoBackupEnabled: val > 0,
                                                    autoBackupInterval: val,
                                                    messageCountSinceLastBackup: 0 // Reset counter on change
                                                }));
                                            }}
                                            className="w-full p-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0061FE]"
                                        >
                                            <option value={0}>手動同期のみ</option>
                                            <option value={1}>メッセージ送信後すぐ (即時)</option>
                                            <option value={5}>5メッセージごと</option>
                                            <option value={10}>10メッセージごと</option>
                                            <option value={30}>30メッセージごと</option>
                                        </select>
                                    </div>

                                    {dropboxUser ? (
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                                <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                                <span><span className="font-bold">{dropboxUser}</span> のアカウントと連携済みです。</span>
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                最終同期: {config.lastBackupTime ? new Date(config.lastBackupTime).toLocaleString() : 'なし'}
                                            </div>

                                            <div className="pt-2">
                                                <div className="font-bold text-sm text-gray-800 mb-2">同期オプション:</div>
                                                <button
                                                    onClick={async () => {
                                                        setIsProcessing(true);
                                                        setProcessStatus("スマート同期中...");
                                                        try {
                                                            const result = await dropboxService.sync();
                                                            onUpdateConfig(prev => ({ ...prev, lastBackupTime: Date.now() }));

                                                            let msg = "同期完了: 最新の状態です。";
                                                            if (result === 'uploaded') msg = "同期完了: クラウドへアップロードしました。";
                                                            if (result === 'downloaded') {
                                                                msg = "同期完了: クラウドから復元しました。リロードします。";
                                                                alert(msg);
                                                                window.location.reload();
                                                                return;
                                                            }
                                                            alert(msg);
                                                        } catch (e: any) {
                                                            alert("同期失敗: " + (e.message || JSON.stringify(e)));
                                                            console.error(e);
                                                        } finally {
                                                            setIsProcessing(false);
                                                        }
                                                    }}
                                                    className="w-full py-3 bg-[#0061FE] text-white rounded-lg font-bold text-sm hover:bg-blue-600 transition-colors shadow-sm flex items-center justify-center gap-2"
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                    スマート同期 (推奨)
                                                </button>
                                                <p className="text-[10px] text-gray-400 mt-1 ml-1">
                                                    ※新しい方のデータを優先して同期します。
                                                </p>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 pt-2">
                                                <button
                                                    onClick={async () => {
                                                        if (!confirm("現在のデータでクラウドを上書きしますか？")) return;
                                                        setIsProcessing(true);
                                                        setProcessStatus("アップロード中...");
                                                        try {
                                                            const json = await dbService.exportAllData();
                                                            await dropboxService.uploadData(json);
                                                            onUpdateConfig(prev => ({ ...prev, lastBackupTime: Date.now() }));
                                                            alert("アップロードしました！");
                                                        } catch (e: any) {
                                                            alert("失敗: " + e.message);
                                                        } finally {
                                                            setIsProcessing(false);
                                                        }
                                                    }}
                                                    className="py-2 bg-white border border-gray-300 text-gray-600 rounded-lg font-bold text-xs hover:bg-gray-50"
                                                >
                                                    強制アップロード
                                                </button>
                                                <button
                                                    onClick={async () => {
                                                        if (!confirm("クラウドにデータがない場合エラーになります。\n現在のデータを上書きして復元しますか？")) return;
                                                        setIsProcessing(true);
                                                        setProcessStatus("ダウンロード中...");
                                                        try {
                                                            const json = await dropboxService.downloadData();
                                                            if (!json) throw new Error("クラウドにデータがありません");
                                                            await dbService.restoreAllData(json);
                                                            alert("復元しました！リロードします。");
                                                            window.location.reload();
                                                        } catch (e: any) {
                                                            alert("失敗: " + e.message);
                                                        } finally {
                                                            setIsProcessing(false);
                                                        }
                                                    }}
                                                    className="py-2 bg-white border border-gray-300 text-gray-600 rounded-lg font-bold text-xs hover:bg-gray-50"
                                                >
                                                    強制ダウンロード
                                                </button>
                                            </div>

                                            <div className="pt-4 border-t border-gray-100">
                                                <button
                                                    onClick={async () => {
                                                        if (!confirm("Dropboxとの連携を解除しますか？")) return;
                                                        try {
                                                            await dropboxService.disconnect();
                                                            setDropboxUser(null);
                                                            alert("連携を解除しました。");
                                                        } catch (e: any) {
                                                            setDropboxUser(null);
                                                            alert("連携を解除しました。");
                                                        }
                                                    }}
                                                    className="w-full py-2 bg-red-50 text-red-600 rounded-lg font-bold text-sm hover:bg-red-100 transition-colors"
                                                >
                                                    連携を解除
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="text-sm text-gray-600 leading-relaxed">
                                                Dropboxアカウントと連携して、異なるブラウザ間でPWAの全データを安全に同期します。<br />
                                                スマート同期機能により、常に最新のデータを自動的に判別して同期します。
                                            </div>
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const authUrl = await dropboxService.generateAuthUrl();
                                                        window.location.href = authUrl;
                                                    } catch (e: any) {
                                                        alert("認証エラー: " + e.message);
                                                    }
                                                }}
                                                className="w-full py-3 bg-[#0061FE] text-white rounded-lg font-bold text-sm hover:bg-blue-600 transition-colors shadow-sm flex items-center justify-center gap-2"
                                            >
                                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 3l-6 4.5 6 4.5 6-4.5-6-4.5zm12 0l-6 4.5 6 4.5 6-4.5-6-4.5zm-12 18l-6-4.5 5.25-3.938 6.75 5.063-6 3.375zm12 0l-6-3.375 6.75-5.063 5.25 3.938-6 4.5zm-6-6.375l-5.625-4.219-5.625 4.219-6-4.5 11.625-8.625 11.625 8.625-6 4.5-5.625-4.219-5.625 4.219z" /></svg>
                                                Dropboxと連携する
                                            </button>
                                            <div className="text-[10px] text-gray-400 text-center font-mono">
                                                Redirect URI: {dropboxService.getCurrentRedirectUri()}
                                            </div>
                                        </div>
                                    )}

                                </div>
                            </div>
                        </div>
                    )}

                </div>
            </div>

            {/* Image Cropper Modal */}
            {cropperImage && (
                <ImageCropper
                    imageSrc={cropperImage}
                    onCrop={handleCropComplete}
                    onCancel={() => setCropperImage(null)}
                    outputSize={300}
                />
            )}

            {/* Image Search Modal */}
            <ImageUrlInput
                isOpen={urlInputTarget !== null}
                onClose={() => setUrlInputTarget(null)}
                title={urlInputTarget === 'aiAvatar' ? 'アイコンを検索' : '背景画像を検索'}
                searchKeyword={`白猫 ${config.aiName}`}
                onConfirm={() => { }}
            />
        </div >
    );
};