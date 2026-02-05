
import React from 'react';
import { ChatSession } from '../types';

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  currentSessionId: string;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  onDuplicateSession: (id: string) => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  isOpen,
  onClose,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onDuplicateSession
}) => {
  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={onClose}
          style={{ touchAction: 'none' }}
        />
      )}

      <div className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#2b3542] text-white shadow-2xl transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          <div className="p-4 border-b border-white/10 flex justify-between items-center pt-safe" style={{ paddingTop: `max(env(safe-area-inset-top, 0px), 1rem)` }}>
            <h2 className="font-bold text-lg">履歴</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-4">
            <button
              onClick={() => {
                onNewChat();
                onClose();
              }}
              className="w-full py-3 px-2 bg-[#06c755] hover:bg-[#05b34c] text-white font-bold rounded-xl flex items-center justify-center gap-1 transition-colors shadow-lg text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新しいチャットを始める
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 overscroll-contain">
            {sessions.length === 0 ? (
              <div className="text-center text-gray-400 mt-10 text-sm">
                履歴はありません
              </div>
            ) : (
              <div className="space-y-1 pb-4">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`group relative rounded-lg transition-colors ${session.id === currentSessionId ? 'bg-white/10' : 'hover:bg-white/5'
                      }`}
                  >
                    <div
                      className="flex p-3 cursor-pointer items-center"
                      onClick={() => {
                        onSelectSession(session.id);
                        onClose();
                      }}
                    >
                      <div className="mr-3 relative">
                        <div className="w-10 h-10 rounded-full overflow-hidden bg-white/20 flex-shrink-0 border border-white/10">
                          {session.aiAvatar ? (
                            <img src={session.aiAvatar} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-bold text-xs">
                              {session.aiName?.[0] || 'G'}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <span className="font-bold text-sm truncate text-white/90">{session.aiName || 'Gemini'}</span>
                          <span className="text-[10px] text-gray-500 ml-1 flex-shrink-0">
                            {new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                          </span>
                        </div>
                        <span className="text-xs text-gray-300 truncate block mb-0.5 font-medium">
                          {session.title}
                        </span>
                        <span className="text-[10px] text-gray-500 truncate block h-4">
                          {session.preview}
                        </span>
                      </div>
                    </div>

                    <div
                      className={`absolute bottom-2 right-2 flex gap-1 bg-[#2b3542] rounded-lg p-1 z-20 shadow-lg border border-white/10 transition-opacity duration-200 ${session.id === currentSessionId ? 'opacity-100 pointer-events-auto' : 'opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto'
                        }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDuplicateSession(session.id);
                        }}
                        className="p-1.5 text-gray-400 hover:text-green-400 hover:bg-green-500/20 rounded-md transition-colors"
                        title="複製"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/20 rounded-md transition-colors"
                        title="削除"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
