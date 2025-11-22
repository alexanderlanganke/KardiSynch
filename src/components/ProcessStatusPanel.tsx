import React, { useState, useEffect } from 'react';
import { Activity, CheckCircle } from 'lucide-react';

interface StatusUpdate {
    type: 'start' | 'progress' | 'complete' | 'error';
    message: string;
    file?: string;
    timestamp: number;
}

const ProcessStatusPanel: React.FC = () => {
    const [updates, setUpdates] = useState<StatusUpdate[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        const handleStatus = (status: any) => {
            const newUpdate = { ...status, timestamp: Date.now() };
            setUpdates(prev => [newUpdate, ...prev].slice(0, 50)); // Keep last 50 updates

            if (status.type === 'start' || status.type === 'progress') {
                setIsProcessing(true);
            } else if (status.type === 'complete' && status.message === 'Processing complete.') {
                // Keep showing "Processing complete" for a moment, then hide or switch state
                setTimeout(() => setIsProcessing(false), 3000);
            }
        };

        window.electronAPI.onProcessStatus(handleStatus);

        return () => {
            window.electronAPI.removeListener('process-status', handleStatus);
        };
    }, []);

    if (updates.length === 0) return null;

    const latestUpdate = updates[0];

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 pointer-events-none">
            {/* Main Status Bar */}
            <div
                className={`pointer-events-auto bg-white dark:bg-slate-800 rounded-full shadow-lg border border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center gap-3 transition-all duration-300 ${isProcessing ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}
            >
                <div className="flex items-center gap-2">
                    {isProcessing ? (
                        <Activity className="w-4 h-4 text-blue-500 animate-pulse" />
                    ) : (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
                        {latestUpdate?.message || 'Ready'}
                    </span>
                </div>
                {latestUpdate?.file && (
                    <span className="text-xs text-slate-400 dark:text-slate-500 font-mono max-w-[150px] truncate border-l border-slate-200 dark:border-slate-700 pl-3">
                        {latestUpdate.file}
                    </span>
                )}
            </div>
        </div>
    );
};

export default ProcessStatusPanel;
