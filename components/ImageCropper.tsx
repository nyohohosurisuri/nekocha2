import React, { useRef, useState, useEffect, useCallback } from 'react';

interface ImageCropperProps {
          imageSrc: string;
          onCrop: (croppedDataUrl: string) => void;
          onCancel: () => void;
          outputSize?: number; // Output image size in pixels (default: 300)
}

export const ImageCropper: React.FC<ImageCropperProps> = ({
          imageSrc,
          onCrop,
          onCancel,
          outputSize = 300
}) => {
          const containerRef = useRef<HTMLDivElement>(null);
          const [image, setImage] = useState<HTMLImageElement | null>(null);
          const [scale, setScale] = useState(1);
          const [position, setPosition] = useState({ x: 0, y: 0 });
          const [isDragging, setIsDragging] = useState(false);
          const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
          const [containerSize, setContainerSize] = useState(280);

          // Load image
          useEffect(() => {
                    const img = new Image();
                    img.onload = () => {
                              setImage(img);
                              // Center the image initially
                              setPosition({ x: 0, y: 0 });
                              // Set initial scale to fit the circle
                              const minDim = Math.min(img.width, img.height);
                              const initialScale = containerSize / minDim;
                              setScale(Math.max(1, initialScale));
                    };
                    img.src = imageSrc;
          }, [imageSrc, containerSize]);

          // Handle dragging
          const handleMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
                    e.preventDefault();
                    setIsDragging(true);
                    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
                    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
                    setDragStart({ x: clientX - position.x, y: clientY - position.y });
          }, [position]);

          const handleMouseMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
                    if (!isDragging) return;
                    e.preventDefault();
                    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
                    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
                    setPosition({
                              x: clientX - dragStart.x,
                              y: clientY - dragStart.y
                    });
          }, [isDragging, dragStart]);

          const handleMouseUp = useCallback(() => {
                    setIsDragging(false);
          }, []);

          // Handle crop
          const handleCrop = useCallback(() => {
                    if (!image) return;

                    const canvas = document.createElement('canvas');
                    canvas.width = outputSize;
                    canvas.height = outputSize;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return;

                    // Calculate source coordinates
                    const scaledWidth = image.width * scale;
                    const scaledHeight = image.height * scale;

                    // Center of the crop circle relative to the scaled image
                    const cropCenterX = containerSize / 2 - position.x;
                    const cropCenterY = containerSize / 2 - position.y;

                    // Convert back to original image coordinates
                    const srcCenterX = cropCenterX / scale;
                    const srcCenterY = cropCenterY / scale;
                    const srcRadius = (containerSize / 2) / scale;

                    // Create circular clip
                    ctx.beginPath();
                    ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
                    ctx.clip();

                    // Draw the image
                    ctx.drawImage(
                              image,
                              srcCenterX - srcRadius,
                              srcCenterY - srcRadius,
                              srcRadius * 2,
                              srcRadius * 2,
                              0,
                              0,
                              outputSize,
                              outputSize
                    );

                    // Export as PNG for transparency
                    const dataUrl = canvas.toDataURL('image/png');
                    onCrop(dataUrl);
          }, [image, scale, position, containerSize, outputSize, onCrop]);

          return (
                    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
                              <div className="bg-white rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl">
                                        {/* Header */}
                                        <div className="px-4 py-3 border-b border-gray-200">
                                                  <h3 className="text-lg font-bold text-center">アイコンを調整</h3>
                                                  <p className="text-xs text-gray-500 text-center mt-1">ドラッグで位置調整、スライダーで拡大縮小</p>
                                        </div>

                                        {/* Cropper area */}
                                        <div className="p-4 bg-gray-100">
                                                  <div
                                                            ref={containerRef}
                                                            className="relative mx-auto overflow-hidden cursor-move"
                                                            style={{
                                                                      width: containerSize,
                                                                      height: containerSize,
                                                                      borderRadius: '50%',
                                                                      touchAction: 'none'
                                                            }}
                                                            onMouseDown={handleMouseDown}
                                                            onMouseMove={handleMouseMove}
                                                            onMouseUp={handleMouseUp}
                                                            onMouseLeave={handleMouseUp}
                                                            onTouchStart={handleMouseDown}
                                                            onTouchMove={handleMouseMove}
                                                            onTouchEnd={handleMouseUp}
                                                  >
                                                            {/* Image */}
                                                            {image && (
                                                                      <img
                                                                                src={imageSrc}
                                                                                alt="Crop preview"
                                                                                className="absolute pointer-events-none select-none"
                                                                                style={{
                                                                                          width: image.width * scale,
                                                                                          height: image.height * scale,
                                                                                          left: position.x,
                                                                                          top: position.y,
                                                                                          maxWidth: 'none'
                                                                                }}
                                                                                draggable={false}
                                                                      />
                                                            )}
                                                  </div>

                                                  {/* Decorative ring */}
                                                  <div
                                                            className="absolute pointer-events-none"
                                                            style={{
                                                                      width: containerSize + 8,
                                                                      height: containerSize + 8,
                                                                      borderRadius: '50%',
                                                                      border: '4px solid #06c755',
                                                                      left: '50%',
                                                                      top: '50%',
                                                                      transform: 'translate(-50%, -50%)',
                                                                      marginTop: '-8px'
                                                            }}
                                                  />

                                                  {/* Zoom slider */}
                                                  <div className="mt-4 px-4">
                                                            <div className="flex items-center gap-3">
                                                                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
                                                                      </svg>
                                                                      <input
                                                                                type="range"
                                                                                min="0.5"
                                                                                max="3"
                                                                                step="0.01"
                                                                                value={scale}
                                                                                onChange={(e) => setScale(parseFloat(e.target.value))}
                                                                                className="flex-1 h-2 bg-gray-300 rounded-full appearance-none cursor-pointer accent-[#06c755]"
                                                                      />
                                                                      <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                                                                      </svg>
                                                            </div>
                                                  </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex border-t border-gray-200">
                                                  <button
                                                            onClick={onCancel}
                                                            className="flex-1 py-3 text-gray-600 font-medium hover:bg-gray-50 transition-colors"
                                                  >
                                                            キャンセル
                                                  </button>
                                                  <div className="w-px bg-gray-200" />
                                                  <button
                                                            onClick={handleCrop}
                                                            className="flex-1 py-3 text-[#06c755] font-bold hover:bg-green-50 transition-colors"
                                                  >
                                                            確定
                                                  </button>
                                        </div>
                              </div>
                    </div>
          );
};
