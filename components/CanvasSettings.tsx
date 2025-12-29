

import React, { useEffect, useMemo, useState } from 'react';
import type { WheelAction } from '../types';
import { getJson, postJson, putJson } from '../services/ai/backendApi';

type AdminPlatform = {
    id: string;
    baseUrl: string;
    model: string;
    apiKeyMasked?: string;
    hasApiKey?: boolean;
};

type PlatformRow = AdminPlatform & { apiKeyInput: string };

type MonitorStatus = {
    id: string;
    baseUrl: string;
    model: string;
    checkedAt: string;
    ok: boolean;
    latencyMs: number;
    errorMessage: string | null;
};

type BusyAction = null | 'load' | 'login' | 'logout' | 'save' | 'refresh' | 'check';

const Spinner: React.FC<{ className?: string }> = ({ className = '' }) => (
    <svg
        className={`animate-spin ${className}`}
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
    >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
        />
    </svg>
);

interface CanvasSettingsProps {
    isOpen: boolean;
    onClose: () => void;
    canvasBackgroundColor: string;
    onCanvasBackgroundColorChange: (color: string) => void;
    language: 'en' | 'zho';
    setLanguage: (lang: 'en' | 'zho') => void;
    uiTheme: { color: string; opacity: number };
    setUiTheme: (theme: { color: string; opacity: number }) => void;
    buttonTheme: { color: string; opacity: number };
    setButtonTheme: (theme: { color: string; opacity: number }) => void;
    wheelAction: WheelAction;
    setWheelAction: (action: WheelAction) => void;
    t: (key: string) => string;
}

export const CanvasSettings: React.FC<CanvasSettingsProps> = ({
    isOpen,
    onClose,
    canvasBackgroundColor,
    onCanvasBackgroundColorChange,
    language,
    setLanguage,
    uiTheme,
    setUiTheme,
    buttonTheme,
    setButtonTheme,
    wheelAction,
    setWheelAction,
    t
}) => {
    if (!isOpen) return null;

    const [authPassword, setAuthPassword] = useState('');
    const [loggedIn, setLoggedIn] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);
    const [busyAction, setBusyAction] = useState<BusyAction>(null);
    const [platformRows, setPlatformRows] = useState<PlatformRow[]>([]);
    const [monitorStatus, setMonitorStatus] = useState<MonitorStatus[]>([]);

    const busy = busyAction !== null;
    const canEditPlatforms = loggedIn && !busy;

    const loadAll = async () => {
        setAiError(null);
        const me = await getJson<{ ok: true; loggedIn: boolean }>('/api/auth/me');
        setLoggedIn(Boolean(me.loggedIn));
        if (!me.loggedIn) return;

        const platformsRes = await getJson<{ ok: true; platforms: AdminPlatform[] }>('/api/admin/gemini/platforms');
        setPlatformRows((platformsRes.platforms || []).map((p) => ({ ...p, apiKeyInput: '' })));

        const statusRes = await getJson<{ ok: true; status: MonitorStatus[] }>('/api/monitor/gemini');
        setMonitorStatus(statusRes.status || []);
    };

    useEffect(() => {
        // 打开面板时自动刷新一次（避免每次渲染都触发网络请求）
        setBusyAction('load');
        loadAll().catch((e) => setAiError(e instanceof Error ? e.message : String(e))).finally(() => setBusyAction(null));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const login = async () => {
        setBusyAction('login');
        setAiError(null);
        try {
            await postJson('/api/auth/login', { password: authPassword });
            setAuthPassword('');
            await loadAll();
        } catch (e) {
            setAiError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusyAction(null);
        }
    };

    const logout = async () => {
        setBusyAction('logout');
        setAiError(null);
        try {
            await postJson('/api/auth/logout', {});
            setLoggedIn(false);
            setPlatformRows([]);
            setMonitorStatus([]);
        } catch (e) {
            setAiError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusyAction(null);
        }
    };

    const addPlatformRow = () => {
        const id = `gemini#local:${Date.now()}`;
        setPlatformRows((prev) => [
            ...prev,
            { id, baseUrl: '', model: '', apiKeyMasked: '', hasApiKey: false, apiKeyInput: '' },
        ]);
    };

    const savePlatforms = async () => {
        setBusyAction('save');
        setAiError(null);
        try {
            const missingKey = platformRows.some((p) => !p.hasApiKey && !p.apiKeyInput.trim());
            if (missingKey) throw new Error(t('settings.ai.missingNewKey'));

            await putJson('/api/admin/gemini/platforms', {
                platforms: platformRows.map((p) => ({
                    id: p.id,
                    baseUrl: p.baseUrl,
                    model: p.model,
                    ...(p.apiKeyInput.trim() ? { apiKey: p.apiKeyInput.trim() } : {}),
                })),
            });
            await loadAll();
        } catch (e) {
            setAiError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusyAction(null);
        }
    };

    const refreshMonitor = async () => {
        setBusyAction('refresh');
        setAiError(null);
        try {
            const statusRes = await getJson<{ ok: true; status: MonitorStatus[] }>('/api/monitor/gemini');
            setMonitorStatus(statusRes.status || []);
        } catch (e) {
            setAiError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusyAction(null);
        }
    };

    const checkNow = async () => {
        setBusyAction('check');
        setAiError(null);
        try {
            const statusRes = await postJson<{ ok: true; status: MonitorStatus[] }>('/api/monitor/gemini/check', {});
            setMonitorStatus(statusRes.status || []);
        } catch (e) {
            setAiError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusyAction(null);
        }
    };

    const monitorById = useMemo(() => new Map(monitorStatus.map((s) => [s.id, s])), [monitorStatus]);

    return (
        <div 
            className="fixed inset-0 z-[45] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div 
                className="relative p-6 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col space-y-4 w-[960px] max-w-[96vw] max-h-[92vh] overflow-y-auto bp-scrollbar text-white"
                style={{ backgroundColor: 'var(--ui-bg-color)' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-semibold">{t('settings.title')}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-full">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                
                <div className="border-t border-white/10 -mx-6"></div>

                {/* Language Settings */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">{t('settings.language')}</label>
                    <div className="flex items-center gap-2 p-1 bg-black/20 rounded-md">
                        <button 
                            onClick={() => setLanguage('en')}
                            className={`flex-1 py-1.5 text-sm rounded ${language === 'en' ? 'bg-blue-500 text-white' : 'hover:bg-white/10'}`}
                        >
                            English
                        </button>
                        <button 
                            onClick={() => setLanguage('zho')}
                            className={`flex-1 py-1.5 text-sm rounded ${language === 'zho' ? 'bg-blue-500 text-white' : 'hover:bg-white/10'}`}
                        >
                            中文
                        </button>
                    </div>
                </div>

                {/* UI Theme Settings */}
                <div className="space-y-3">
                    <h4 className="text-sm font-medium text-gray-300">{t('settings.uiTheme')}</h4>
                    <div className="flex items-center justify-between">
                        <label htmlFor="ui-color" className="text-sm text-gray-300">{t('settings.color')}</label>
                        <input
                            id="ui-color"
                            type="color"
                            value={uiTheme.color}
                            onChange={(e) => setUiTheme({ ...uiTheme, color: e.target.value })}
                            className="w-8 h-8 p-0 border-none rounded-md cursor-pointer bg-transparent"
                        />
                    </div>
                    <div className="flex items-center justify-between space-x-3">
                        <label htmlFor="ui-opacity" className="text-sm text-gray-300">{t('settings.opacity')}</label>
                        <input
                            id="ui-opacity"
                            type="range"
                            min="0.1"
                            max="1"
                            step="0.05"
                            value={uiTheme.opacity}
                            onChange={(e) => setUiTheme({ ...uiTheme, opacity: parseFloat(e.target.value) })}
                            className="w-32"
                        />
                         <span className="text-xs text-gray-400 w-8 text-right">{Math.round(uiTheme.opacity * 100)}%</span>
                    </div>
                </div>

                <div className="border-t border-white/10 -mx-6"></div>

                {/* Button Theme Settings */}
                <div className="space-y-3">
                    <h4 className="text-sm font-medium text-gray-300">{t('settings.actionButtonsTheme')}</h4>
                    <div className="flex items-center justify-between">
                        <label htmlFor="button-color" className="text-sm text-gray-300">{t('settings.color')}</label>
                        <input
                            id="button-color"
                            type="color"
                            value={buttonTheme.color}
                            onChange={(e) => setButtonTheme({ ...buttonTheme, color: e.target.value })}
                            className="w-8 h-8 p-0 border-none rounded-md cursor-pointer bg-transparent"
                        />
                    </div>
                    <div className="flex items-center justify-between space-x-3">
                        <label htmlFor="button-opacity" className="text-sm text-gray-300">{t('settings.opacity')}</label>
                        <input
                            id="button-opacity"
                            type="range"
                            min="0.1"
                            max="1"
                            step="0.05"
                            value={buttonTheme.opacity}
                            onChange={(e) => setButtonTheme({ ...buttonTheme, opacity: parseFloat(e.target.value) })}
                            className="w-32"
                        />
                 <span className="text-xs text-gray-400 w-8 text-right">{Math.round(buttonTheme.opacity * 100)}%</span>
                    </div>
                </div>

                <div className="border-t border-white/10 -mx-6"></div>

                {/* AI Settings (server-side secrets) */}
                <div className="space-y-3">
                    <h4 className="text-sm font-medium text-gray-300">{t('settings.ai.title')}</h4>

                    <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-gray-300">
                            {loggedIn ? t('settings.ai.loggedIn') : t('settings.ai.notLoggedIn')}
                        </div>
                        <div className="flex items-center gap-2">
                            {!loggedIn ? (
                                <>
                                    <input
                                        type="password"
                                        value={authPassword}
                                        onChange={(e) => setAuthPassword(e.target.value)}
                                        placeholder={t('settings.ai.passwordPlaceholder')}
                                        className="px-2 py-1 rounded bg-black/20 border border-white/10 text-sm w-44"
                                        disabled={busy}
                                    />
                                    <button
                                        onClick={login}
                                        disabled={busy || !authPassword.trim()}
                                        className="px-3 py-1.5 text-sm rounded bg-blue-500 disabled:bg-blue-500/40 inline-flex items-center gap-2"
                                    >
                                        {busyAction === 'login' && <Spinner className="text-white/90" />}
                                        {t('settings.ai.login')}
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={logout}
                                    disabled={busy}
                                    className="px-3 py-1.5 text-sm rounded bg-white/20 inline-flex items-center gap-2"
                                >
                                    {busyAction === 'logout' && <Spinner className="text-white/80" />}
                                    {t('settings.ai.logout')}
                                </button>
                            )}
                        </div>
                    </div>

                    {aiError && (
                        <div className="text-xs text-red-300 bg-red-500/10 border border-red-400/20 rounded p-2">
                            {aiError}
                        </div>
                    )}

                    {loggedIn && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-xs text-gray-300">{t('settings.ai.platforms')}</div>
                                <div className="flex items-center gap-2">
                                    <button onClick={addPlatformRow} disabled={!canEditPlatforms} className="px-2 py-1 text-xs rounded bg-white/15">
                                        {t('settings.ai.add')}
                                    </button>
                                    <button
                                        onClick={savePlatforms}
                                        disabled={!canEditPlatforms}
                                        className="px-2 py-1 text-xs rounded bg-blue-500/90 inline-flex items-center gap-2"
                                    >
                                        {busyAction === 'save' && <Spinner className="text-white/90" />}
                                        {t('settings.ai.save')}
                                    </button>
                                </div>
                            </div>

                            <div className="max-h-40 overflow-auto bp-scrollbar border border-white/10 rounded-lg">
                                <div className="grid grid-cols-12 gap-2 p-2 text-sm text-gray-300 border-b border-white/10 bg-black/10">
                                    <div className="col-span-5">{t('settings.ai.baseUrl')}</div>
                                    <div className="col-span-4">{t('settings.ai.model')}</div>
                                    <div className="col-span-3">{t('settings.ai.apiKey')}</div>
                                </div>
                                {platformRows.length === 0 ? (
                                    <div className="p-3 text-xs text-gray-400">{t('settings.ai.empty')}</div>
                                ) : (
                                    platformRows.map((row, idx) => {
                                        const status = monitorById.get(row.id);
                                        return (
                                            <div key={row.id} className="grid grid-cols-12 gap-2 p-2 border-b border-white/5">
                                                    <input
                                                        className="col-span-5 px-2 py-1 rounded bg-black/20 border border-white/10 text-sm"
                                                        value={row.baseUrl}
                                                        disabled={!canEditPlatforms}
                                                        onChange={(e) =>
                                                            setPlatformRows((prev) => prev.map((p, i) => (i === idx ? { ...p, baseUrl: e.target.value } : p)))
                                                        }
                                                        placeholder="https://..."
                                                    />
                                                    <input
                                                        className="col-span-4 px-2 py-1 rounded bg-black/20 border border-white/10 text-sm"
                                                        value={row.model}
                                                        disabled={!canEditPlatforms}
                                                        onChange={(e) =>
                                                            setPlatformRows((prev) => prev.map((p, i) => (i === idx ? { ...p, model: e.target.value } : p)))
                                                        }
                                                        placeholder="gemini-..."
                                                    />
                                                    <input
                                                        className="col-span-3 px-2 py-1 rounded bg-black/20 border border-white/10 text-sm"
                                                        type="password"
                                                        value={row.apiKeyInput}
                                                        disabled={!canEditPlatforms}
                                                        onChange={(e) =>
                                                            setPlatformRows((prev) =>
                                                                prev.map((p, i) => (i === idx ? { ...p, apiKeyInput: e.target.value } : p))
                                                            )
                                                        }
                                                        placeholder={row.apiKeyMasked || ''}
                                                    />
                                                    {status && (
                                                        <div className="col-span-12 text-xs text-gray-400 mt-1">
                                                            {status.ok ? t('settings.ai.statusOk') : t('settings.ai.statusBad')} · {status.latencyMs}ms · {status.checkedAt}
                                                            {!status.ok && status.errorMessage ? ` · ${status.errorMessage}` : ''}
                                                        </div>
                                                    )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={refreshMonitor}
                                    disabled={!canEditPlatforms}
                                    className="px-2 py-1 text-xs rounded bg-white/15 inline-flex items-center gap-2"
                                >
                                    {busyAction === 'refresh' && <Spinner className="text-white/80" />}
                                    {t('settings.ai.refreshStatus')}
                                </button>
                                <button
                                    onClick={checkNow}
                                    disabled={!canEditPlatforms}
                                    className="px-2 py-1 text-xs rounded bg-white/15 inline-flex items-center gap-2"
                                >
                                    {busyAction === 'check' && <Spinner className="text-white/80" />}
                                    {t('settings.ai.checkNow')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Mouse Wheel Settings */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-300">{t('settings.mouseWheel')}</label>
                    <div className="flex items-center gap-2 p-1 bg-black/20 rounded-md">
                        <button 
                            onClick={() => setWheelAction('zoom')}
                            className={`flex-1 py-1.5 text-sm rounded ${wheelAction === 'zoom' ? 'bg-blue-500 text-white' : 'hover:bg-white/10'}`}
                        >
                            {t('settings.zoom')}
                        </button>
                        <button 
                            onClick={() => setWheelAction('pan')}
                            className={`flex-1 py-1.5 text-sm rounded ${wheelAction === 'pan' ? 'bg-blue-500 text-white' : 'hover:bg-white/10'}`}
                        >
                            {t('settings.scroll')}
                        </button>
                    </div>
                </div>


                {/* Canvas Settings */}
                <div className="space-y-3">
                     <h4 className="text-sm font-medium text-gray-300">{t('settings.canvas')}</h4>
                    <div className="flex items-center justify-between">
                        <label htmlFor="bg-color" className="text-sm text-gray-300">{t('settings.backgroundColor')}</label>
                        <input
                            id="bg-color"
                            type="color"
                            value={canvasBackgroundColor}
                            onChange={(e) => onCanvasBackgroundColorChange(e.target.value)}
                            className="w-8 h-8 p-0 border-none rounded-md cursor-pointer bg-transparent"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
