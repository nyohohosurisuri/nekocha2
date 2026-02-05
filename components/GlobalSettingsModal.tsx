
import React, { useRef, useState } from 'react';
import { ChatConfig } from '../types';
import { dbService } from '../services/db';

interface GlobalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataRestoreStart: () => void;
  config: ChatConfig;
  onUpdateConfig: (updateFn: (prev: ChatConfig) => ChatConfig) => void;
}

export const GlobalSettingsModal: React.FC<GlobalSettingsModalProps> = ({
  isOpen,
  onClose,
  onDataRestoreStart,
  config,
  onUpdateConfig,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'exporting' | 'importing'>('idle');

  const handleFullBackup = async () => {
    if (status !== 'idle') return;
    setStatus('exporting');
    try {
      const backupData = await dbService.exportAllData();
      const jsonStr = JSON.stringify(backupData);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("バックアップに失敗しました");
    } finally {
      setStatus('idle');
    }
  };

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm("現在のすべての履歴を消去してファイルを復元しますか？\n(復元後はページがリロードされます)")) {
      e.target.value = '';
      return;
    }

    try {
      setStatus('importing');
      console.log("[Restore] Started reading file:", file.name);

      const reader = new FileReader();
      const text = await new Promise<string>((resolve, reject) => {
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
        reader.readAsText(file);
      });

      // 文字列のクリーンアップ: 最初の '{' から 最後の '}' までを確実に切り出す
      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}');
      if (startIdx === -1 || endIdx === -1) {
        throw new Error("ファイルの中に有効なJSONデータが見つかりませんでした");
      }
      
      const jsonContent = text.substring(startIdx, endIdx + 1);
      const backup = JSON.parse(jsonContent);

      if (!backup || !backup.sessions || !backup.sessionDataItems) {
        throw new Error("データの形式が正しくありません (sessions/sessionDataItems が見つかりません)");
      }

      // App側のオーバーレイを表示
      onDataRestoreStart();

      console.log("[Restore] Invoking dbService.restoreAllData...");
      await dbService.restoreAllData(backup);

      if (backup.localStorage?.presets) {
        localStorage.setItem('chat_prompt_presets', JSON.stringify(backup.localStorage.presets));
      }

      console.log("[Restore] Finished. Reloading...");
      alert("復元が完了しました。ページを更新します。");
      window.location.reload();

    } catch (err: any) {
      console.error("[Restore] Fatal Error:", err);
      alert("復元の実行中にエラーが発生しました:\n" + (err.message || "不明なエラー"));
      setStatus('idle');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-white w-full max-w-sm rounded-3xl p-8 shadow-2xl space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-black text-gray-800">システム設定</h2>
          {status === 'idle' && (
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2">✕</button>
          )}
        </div>
        
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
            <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-3">保存</p>
            <button 
              type="button"
              onClick={handleFullBackup} 
              disabled={status !== 'idle'}
              className="w-full py-4 bg-blue-500 hover:bg-blue-600 text-white rounded-2xl font-black transition-all"
            >
              {status === 'exporting' ? '書き出し中...' : 'データを書き出す'}
            </button>
          </div>
          
          <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">復元</p>
            <button 
              type="button"
              onClick={() => fileInputRef.current?.click()} 
              disabled={status !== 'idle'}
              className="w-full py-4 bg-[#2b3542] hover:bg-black text-white rounded-2xl font-black transition-all"
            >
              {status === 'importing' ? '復元中...' : 'ファイルから復元'}
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              accept=".json" 
              className="hidden" 
              onChange={handleRestoreBackup} 
            />
          </div>
        </div>

        {status === 'idle' && (
          <button type="button" onClick={onClose} className="w-full py-3 text-gray-400 font-bold">キャンセル</button>
        )}
      </div>
    </div>
  );
};
