import React, { useState, useEffect } from 'react';
import { Bell, Check, X, Activity, Trash2, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface Notification {
    id: number;
    type: 'info' | 'warning' | 'error' | 'success';
    title?: string;
    message: string;
    timestamp: number;
    read: boolean;
    action?: {
        label: string;
        onClick: () => void;
    };
}

interface Task {
    id: string;
    title: string;
    progress: number; // 0-100
    status: 'pending' | 'running' | 'completed' | 'error';
    message: string;
    timestamp: number;
}

const NotificationCenter: React.FC = () => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [isOpen, setIsOpen] = useState(false);

    // Listen for notifications
    useEffect(() => {
        const handleNotify = (type: 'info' | 'warning' | 'error', message: string) => {
            const newNotification: Notification = {
                id: Date.now(),
                type: type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info',
                message,
                timestamp: Date.now(),
                read: false,
            };
            setNotifications(prev => [newNotification, ...prev]);
        };

        const cleanup = window.electronAPI.onNotify(handleNotify);
        return () => cleanup();
    }, []);

    // Listen for process status (tasks)
    useEffect(() => {
        const handleStatus = (status: any) => {
            setTasks(prev => {
                const existingTaskIndex = prev.findIndex(t => t.id === status.taskId || (status.type === 'start' && t.title === status.message));

                // If it's a generic "start" without ID, treat it as a new task or update existing generic one
                // Ideally backend should send taskId. If not, we use a simple heuristic.
                const taskId = status.taskId || 'global-task';

                let newTasks = [...prev];
                const taskIndex = newTasks.findIndex(t => t.id === taskId);

                if (taskIndex >= 0) {
                    // Update existing task
                    newTasks[taskIndex] = {
                        ...newTasks[taskIndex],
                        progress: status.progress !== undefined ? status.progress : newTasks[taskIndex].progress,
                        message: status.message || newTasks[taskIndex].message,
                        status: status.type === 'complete' ? 'completed' : status.type === 'error' ? 'error' : 'running',
                    };
                } else {
                    // New task
                    if (status.type !== 'complete') { // Don't start a task on complete event if we missed start
                        newTasks.unshift({
                            id: taskId,
                            title: status.title || 'Background Task',
                            progress: status.progress || 0,
                            status: 'running',
                            message: status.message,
                            timestamp: Date.now()
                        });
                    }
                }

                // Auto-remove completed tasks after 5 seconds
                if (status.type === 'complete') {
                    setTimeout(() => {
                        setTasks(current => current.filter(t => t.id !== taskId));
                    }, 5000);
                }

                return newTasks;
            });
        };

        const cleanup = window.electronAPI.onProcessStatus(handleStatus);
        return () => window.electronAPI.removeListener('process-status', handleStatus);
    }, []);

    const unreadCount = notifications.filter(n => !n.read).length;
    const activeTasks = tasks.filter(t => t.status === 'running' || t.status === 'pending');

    const markAllRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    const clearAllNotifications = () => {
        setNotifications([]);
    };

    const removeNotification = (id: number) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'error': return <AlertCircle className="h-4 w-4 text-red-500" />;
            case 'warning': return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
            case 'success': return <Check className="h-4 w-4 text-green-500" />;
            default: return <Info className="h-4 w-4 text-blue-500" />;
        }
    };

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative rounded-full h-10 w-10 hover:bg-muted/50"
                >
                    {activeTasks.length > 0 ? (
                        <Activity className="h-5 w-5 animate-pulse text-blue-500" />
                    ) : (
                        <Bell className="h-5 w-5 text-muted-foreground" />
                    )}
                    {unreadCount > 0 && (
                        <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px] bg-red-500 hover:bg-red-600 border-2 border-background">
                            {unreadCount}
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[450px] p-0 bg-background/80 backdrop-blur-xl border-border/40 shadow-2xl" align="end" sideOffset={8}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/20">
                    <h4 className="font-semibold text-sm">Notification Center</h4>
                    {notifications.length > 0 && (
                        <Button variant="ghost" size="xs" className="h-6 text-xs text-muted-foreground hover:text-destructive" onClick={clearAllNotifications}>
                            Clear All
                        </Button>
                    )}
                </div>

                <Tabs defaultValue={activeTasks.length > 0 ? "activity" : "notifications"} className="w-full">
                    <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 h-10">
                        <TabsTrigger
                            value="notifications"
                            className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-10"
                            onClick={markAllRead}
                        >
                            Notifications
                            {unreadCount > 0 && <span className="ml-2 text-xs bg-muted px-1.5 rounded-full">{unreadCount}</span>}
                        </TabsTrigger>
                        <TabsTrigger
                            value="activity"
                            className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent h-10"
                        >
                            Activity
                            {activeTasks.length > 0 && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 rounded-full animate-pulse">{activeTasks.length}</span>}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="notifications" className="m-0">
                        <ScrollArea className="h-[450px]">
                            {notifications.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                    <Bell className="h-8 w-8 mb-2 opacity-20" />
                                    <p className="text-sm">No notifications</p>
                                </div>
                            ) : (
                                <div className="divide-y">
                                    {notifications.map(notification => (
                                        <div key={notification.id} className={cn("p-4 hover:bg-muted/50 transition-colors relative group", !notification.read && "bg-muted/20")}>
                                            <div className="flex gap-3">
                                                <div className="mt-0.5">{getIcon(notification.type)}</div>
                                                <div className="flex-1 space-y-1">
                                                    <p className="text-sm font-medium leading-none">{notification.title || notification.type.toUpperCase()}</p>
                                                    <p className="text-xs text-muted-foreground">{notification.message}</p>
                                                    <p className="text-[10px] text-muted-foreground/60 pt-1">
                                                        {new Date(notification.timestamp).toLocaleTimeString()}
                                                    </p>
                                                    {notification.action && (
                                                        <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={notification.action.onClick}>
                                                            {notification.action.label}
                                                        </Button>
                                                    )}
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity absolute top-2 right-2"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        removeNotification(notification.id);
                                                    }}
                                                >
                                                    <X className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>

                    <TabsContent value="activity" className="m-0">
                        <ScrollArea className="h-[450px]">
                            {tasks.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                    <Activity className="h-8 w-8 mb-2 opacity-20" />
                                    <p className="text-sm">No active tasks</p>
                                </div>
                            ) : (
                                <div className="divide-y">
                                    {tasks.map(task => (
                                        <div key={task.id} className="p-4 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium">{task.title}</span>
                                                <span className={cn("text-xs px-2 py-0.5 rounded-full",
                                                    task.status === 'completed' ? "bg-green-100 text-green-700" :
                                                        task.status === 'error' ? "bg-red-100 text-red-700" :
                                                            "bg-blue-100 text-blue-700"
                                                )}>
                                                    {task.status}
                                                </span>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex justify-between text-xs text-muted-foreground">
                                                    <span>{task.message}</span>
                                                    <span>{Math.round(task.progress)}%</span>
                                                </div>
                                                <Progress value={task.progress} className="h-1.5" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>
                </Tabs>
            </PopoverContent>
        </Popover>
    );
};

export default NotificationCenter;
