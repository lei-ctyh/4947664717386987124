import React from 'react';
import { QuickPrompts } from './QuickPrompts';
import type { UserEffect, GenerationMode } from '../types';
import type { AiProviderId, AiProviderOption } from '../services/ai/registry';

interface PromptBarProps {
    t: (key: string, ...args: any[]) => string;
    prompt: string;
    setPrompt: (prompt: string) => void;
    onGenerate: () => void;
    isLoading: boolean;
    isSelectionActive: boolean;
    selectedElementCount: number;
    userEffects: UserEffect[];
    onAddUserEffect: (effect: UserEffect) => void;
    onDeleteUserEffect: (id: string) => void;
    generationMode: GenerationMode;
    setGenerationMode: (mode: GenerationMode) => void;
    videoAspectRatio: '16:9' | '9:16';
    setVideoAspectRatio: (ratio: '16:9' | '9:16') => void;
    imageAspectRatio: string;
    setImageAspectRatio: (ratio: string) => void;
    imageSize: '1K' | '2K' | '4K';
    setImageSize: (size: '1K' | '2K' | '4K') => void;
    imageCount: 1 | 2 | 3 | 4;
    setImageCount: (count: 1 | 2 | 3 | 4) => void;
    aiProvider: AiProviderId;
    setAiProvider: (provider: AiProviderId) => void;
    aiProviderOptions: AiProviderOption[];
    referenceImages: Array<{ id: string; href: string; mimeType: string }>;
    onReorderReferenceImages: (nextIds: string[]) => void;
}

export const PromptBar: React.FC<PromptBarProps> = ({
    t,
    prompt,
    setPrompt,
    onGenerate,
    isLoading,
    isSelectionActive,
    selectedElementCount,
    userEffects,
    onAddUserEffect,
    onDeleteUserEffect,
    generationMode,
    setGenerationMode,
    videoAspectRatio,
    setVideoAspectRatio,
    imageAspectRatio,
    setImageAspectRatio,
    imageSize,
    setImageSize,
    imageCount,
    setImageCount,
    aiProvider,
    setAiProvider,
    aiProviderOptions,
    referenceImages,
    onReorderReferenceImages,
}) => {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const [draggingId, setDraggingId] = React.useState<string | null>(null);

    const activeProvider = aiProviderOptions.find(p => p.id === aiProvider);
    const supportsVideo = activeProvider?.supportsVideo ?? true;

    React.useEffect(() => {
        if (textareaRef.current) {
            const textarea = textareaRef.current;
            const maxHeightPx = 160;
            textarea.style.height = 'auto';
            const nextHeight = Math.min(textarea.scrollHeight, maxHeightPx);
            textarea.style.height = `${nextHeight}px`;
            textarea.style.overflowY = textarea.scrollHeight > maxHeightPx ? 'auto' : 'hidden';
        }
    }, [prompt]);

    React.useEffect(() => {
        if (!supportsVideo && generationMode === 'video') {
            setGenerationMode('image');
        }
    }, [supportsVideo, generationMode, setGenerationMode]);
    
    const getPlaceholderText = () => {
        if (!isSelectionActive) {
            return generationMode === 'video' ? t('promptBar.placeholderDefaultVideo') : t('promptBar.placeholderDefault');
        }
        if (selectedElementCount === 1) {
            return t('promptBar.placeholderSingle');
        }
        return t('promptBar.placeholderMultiple', selectedElementCount);
    };
    
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isLoading && prompt.trim()) {
                onGenerate();
            }
        }
    };
    
    const handleSaveEffect = () => {
        const name = window.prompt(t('myEffects.saveEffectPrompt'), t('myEffects.defaultName'));
        if (name && prompt.trim()) {
            onAddUserEffect({ id: `user_${Date.now()}`, name, value: prompt });
        }
    };

    const containerStyle: React.CSSProperties = {
        backgroundColor: `var(--ui-bg-color)`,
    };

    const IMAGE_ASPECT_RATIOS: string[] = [
        'auto',
        '1:1',
        '16:9',
        '9:16',
        '4:3',
        '3:4',
        '3:2',
        '2:3',
        '5:4',
        '4:5',
        '21:9',
    ];

    const moveId = React.useCallback((ids: string[], fromId: string, toId: string) => {
        const fromIndex = ids.indexOf(fromId);
        const toIndex = ids.indexOf(toId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return ids;
        const next = [...ids];
        const [item] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, item);
        return next;
    }, []);

    return (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 w-full max-w-5xl px-4">
            {referenceImages.length > 1 && (
                <div className="mb-2 flex justify-center">
                    <div
                        className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/5 border border-white/10 overflow-x-auto bp-scrollbar max-w-full"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => setDraggingId(null)}
                        title="参考图顺序将作为输入顺序"
                    >
                        {referenceImages.map((img, idx) => (
                            <div
                                key={img.id}
                                draggable={!isLoading}
                                onDragStart={(e) => {
                                    setDraggingId(img.id);
                                    e.dataTransfer.effectAllowed = 'move';
                                    e.dataTransfer.setData('text/plain', img.id);
                                }}
                                onDragEnd={() => setDraggingId(null)}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    if (!draggingId || draggingId === img.id) return;
                                    const next = moveId(referenceImages.map(x => x.id), draggingId, img.id);
                                    onReorderReferenceImages(next);
                                }}
                                className={`relative w-12 h-12 rounded-xl overflow-hidden border ${draggingId === img.id ? 'border-white/50 opacity-80' : 'border-white/10'} bg-neutral-900 flex-shrink-0`}
                            >
                                <img
                                    src={img.href}
                                    className="w-full h-full object-cover"
                                    draggable={false}
                                    alt={`ref-${idx + 1}`}
                                />
                                <div className="absolute bottom-1 right-1 w-5 h-5 rounded-md bg-black/70 text-white text-xs flex items-center justify-center border border-white/10">
                                    {idx + 1}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div
                style={containerStyle}
                className="backdrop-blur-xl border border-white/10 rounded-[28px] shadow-2xl"
            >
                <div className="flex items-center gap-3 px-4 py-4">
                    <div className="flex-shrink-0">
                        <QuickPrompts
                            t={t}
                            setPrompt={setPrompt}
                            disabled={isLoading}
                            userEffects={userEffects}
                            onDeleteUserEffect={onDeleteUserEffect}
                        />
                    </div>
                    <div className="flex-grow min-w-0">
                        <textarea
                            ref={textareaRef}
                            rows={1}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={getPlaceholderText()}
                            className="bp-scrollbar w-full bg-transparent text-white placeholder-white/40 focus:outline-none resize-none max-h-40 text-lg sm:text-xl font-medium leading-snug"
                            disabled={isLoading}
                        />
                    </div>
                    <button
                        onClick={handleSaveEffect}
                        disabled={isLoading || !prompt.trim()}
                        aria-label={t('myEffects.saveEffectTooltip')}
                        title={t('myEffects.saveEffectTooltip')}
                        className="flex-shrink-0 w-12 h-12 flex items-center justify-center text-white rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
                    </button>
                </div>

                <div className="h-px bg-white/10 mx-4" />

                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="flex-shrink-0">
                        <select
                            aria-label={t('ai.provider')}
                            title={t('ai.provider')}
                            value={aiProvider}
                            onChange={(e) => setAiProvider(e.target.value as AiProviderId)}
                            className="bg-white/5 text-white text-sm rounded-xl px-3 py-2 border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/20"
                            disabled={isLoading}
                        >
                            {aiProviderOptions.map((p) => (
                                <option key={p.id} value={p.id} className="bg-neutral-900">
                                    {t(p.labelKey)}
                                </option>
                            ))}
                        </select>
                    </div>

                    {generationMode === 'image' && (
                        <div className="flex-shrink-0 flex items-center bg-white/5 border border-white/10 rounded-xl p-1 text-white">
                            {([1, 2, 3, 4] as const).map((count) => (
                                <button
                                    key={count}
                                    type="button"
                                    onClick={() => setImageCount(count)}
                                    disabled={isLoading}
                                    aria-label={`Images ${count}`}
                                    title={`Images ${count}`}
                                    className={`w-9 h-9 flex items-center justify-center text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${imageCount === count ? 'bg-white/10' : 'hover:bg-white/5'}`}
                                >
                                    {count}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="hidden sm:block w-px h-7 bg-white/10" />

                    <div className="flex-shrink-0 flex items-center bg-white/5 border border-white/10 rounded-xl p-1 text-white">
                        <button
                            onClick={() => setGenerationMode('image')}
                            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${generationMode === 'image' ? 'bg-white/10' : 'hover:bg-white/5'}`}
                        >
                            {t('promptBar.imageMode')}
                        </button>
                        <button
                            onClick={() => setGenerationMode('video')}
                            disabled={!supportsVideo}
                            title={!supportsVideo ? t('ai.videoNotSupported') : t('promptBar.videoMode')}
                            className={`px-3 py-1.5 text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${generationMode === 'video' ? 'bg-white/10' : 'hover:bg-white/5'}`}
                        >
                            {t('promptBar.videoMode')}
                        </button>
                    </div>

                    {generationMode === 'image' && (
                        <>
                            <div className="relative flex-shrink-0">
                                <select
                                    aria-label="Aspect Ratio"
                                    title="Aspect Ratio"
                                    value={imageAspectRatio}
                                    onChange={(e) => setImageAspectRatio(e.target.value)}
                                    className="appearance-none bg-white/5 text-white text-sm rounded-xl pl-3 pr-9 py-2 border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/20"
                                    disabled={isLoading}
                                >
                                    {IMAGE_ASPECT_RATIOS.map((ratio) => (
                                        <option key={ratio} value={ratio} className="bg-neutral-900">
                                            {ratio === 'auto' ? 'Auto' : ratio}
                                        </option>
                                    ))}
                                </select>
                                <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/60">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m6 9 6 6 6-6" />
                                    </svg>
                                </div>
                            </div>

                            <div className="relative flex-shrink-0">
                                <select
                                    aria-label="Image Size"
                                    title="Image Size"
                                    value={imageSize}
                                    onChange={(e) => setImageSize(e.target.value as '1K' | '2K' | '4K')}
                                    className="appearance-none bg-white/5 text-white text-sm rounded-xl pl-3 pr-9 py-2 border border-white/10 focus:outline-none focus:ring-2 focus:ring-white/20"
                                    disabled={isLoading}
                                >
                                    {(['1K', '2K', '4K'] as const).map((size) => (
                                        <option key={size} value={size} className="bg-neutral-900">
                                            {size}
                                        </option>
                                    ))}
                                </select>
                                <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/60">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m6 9 6 6 6-6" />
                                    </svg>
                                </div>
                            </div>
                        </>
                    )}

                    {generationMode === 'video' && (
                        <div className="flex-shrink-0 flex items-center bg-white/5 border border-white/10 rounded-xl p-1 text-white">
                            <button
                                onClick={() => setVideoAspectRatio('16:9')}
                                title={t('promptBar.aspectRatioHorizontal')}
                                className={`p-1.5 rounded-lg transition-colors ${videoAspectRatio === '16:9' ? 'bg-white/10' : 'hover:bg-white/5'}`}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="10" rx="2" ry="2"></rect></svg>
                            </button>
                            <button
                                onClick={() => setVideoAspectRatio('9:16')}
                                title={t('promptBar.aspectRatioVertical')}
                                className={`p-1.5 rounded-lg transition-colors ${videoAspectRatio === '9:16' ? 'bg-white/10' : 'hover:bg-white/5'}`}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2" ry="2"></rect></svg>
                            </button>
                        </div>
                    )}

                    <div className="flex-grow" />

                    <button
                        onClick={onGenerate}
                        disabled={isLoading || !prompt.trim()}
                        aria-label={t('promptBar.generate')}
                        title={t('promptBar.generate')}
                        className="flex-shrink-0 w-12 h-12 flex items-center justify-center text-white rounded-2xl border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 transition-all duration-200"
                        style={{ backgroundColor: 'var(--button-bg-color)' }}
                    >
                        {isLoading ? (
                            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        ) : (
                            generationMode === 'image'
                                ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                                : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
