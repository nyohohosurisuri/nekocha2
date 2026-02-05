import React from 'react';

interface ImageUrlInputProps {
          isOpen: boolean;
          onClose: () => void;
          onConfirm: (imageDataUrl: string) => void;
          title?: string;
          searchKeyword?: string;
}

export const ImageUrlInput: React.FC<ImageUrlInputProps> = ({
          isOpen,
          onClose,
          title = '画像を検索',
          searchKeyword = ''
}) => {
          const openGoogleSearch = () => {
                    const query = encodeURIComponent(searchKeyword || 'anime character');
                    window.open(`https://www.google.com/search?q=${query}&tbm=isch`, '_blank');
          };

          if (!isOpen) return null;

          return (
                    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
                              <div className="bg-white rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl">
                                        {/* Header */}
                                        <div className="px-4 py-3 border-b border-gray-200">
                                                  <h3 className="text-lg font-bold text-center">{title}</h3>
                                        </div>

                                        {/* Content */}
                                        <div className="p-4 space-y-4">
                                                  {/* Google Search Button */}
                                                  <button
                                                            onClick={openGoogleSearch}
                                                            className="w-full py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl font-bold text-sm hover:from-blue-600 hover:to-blue-700 transition-all shadow-md flex items-center justify-center gap-2"
                                                  >
                                                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                                                      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                                                            </svg>
                                                            Google画像検索を開く
                                                  </button>

                                                  <div className="text-center text-xs text-gray-500">
                                                            検索画面から画像を探して<br />
                                                            長押し（PCなら右クリック）で保存してください
                                                  </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex border-t border-gray-200">
                                                  <button
                                                            onClick={onClose}
                                                            className="flex-1 py-3 text-gray-600 font-bold hover:bg-gray-50 transition-colors"
                                                  >
                                                            閉じる
                                                  </button>
                                        </div>
                              </div>
                    </div>
          );
};
