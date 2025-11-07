import React, { useState, useEffect } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface Notification {
  id: number;
  type: 'info' | 'warning' | 'error';
  message: string;
}

const NotificationArea: React.FC = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    const handleNotify = (type: 'info' | 'warning' | 'error', message: string) => {
      setNotifications(prev => [...prev, { id: Date.now(), type, message }]);
    };

    const cleanup = window.electronAPI.onNotify(handleNotify);

    return () => {
      cleanup();
    };
  }, []);

  const removeNotification = (id: number) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  return (
    <div className="fixed bottom-4 right-4 w-96 space-y-2 z-50">
      {notifications.map(notification => (
        <Alert key={notification.id} variant={notification.type === 'error' ? 'destructive' : 'default'}>
          <AlertTitle>{notification.type.toUpperCase()}</AlertTitle>
          <AlertDescription>{notification.message}</AlertDescription>
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-1 right-1"
            onClick={() => removeNotification(notification.id)}
          >
            X
          </Button>
        </Alert>
      ))}
    </div>
  );
};

export default NotificationArea;
