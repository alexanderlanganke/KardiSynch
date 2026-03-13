import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight, RotateCw, Loader2 } from 'lucide-react';
import BookmarkBar from '@/components/BookmarkBar';

const WebPanel: React.FC = () => {
  const [url, setUrl] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [bookmarks, setBookmarks] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Show BrowserView when panel mounts
    window.electronAPI.webPanelShow();

    // Load current URL
    window.electronAPI.webPanelGetUrl().then((currentUrl) => {
      if (currentUrl) {
        setUrl(currentUrl);
        setInputValue(currentUrl);
      }
    });

    // Load bookmarks
    window.electronAPI.getWebBookmarks().then(setBookmarks);

    // Listen for URL updates from BrowserView navigation
    window.electronAPI.onWebPanelUrlUpdated((newUrl) => {
      setUrl(newUrl);
      setInputValue(newUrl);
    });

    window.electronAPI.onWebPanelLoading((isLoading) => {
      setLoading(isLoading);
    });

    return () => {
      // Hide BrowserView when panel unmounts
      window.electronAPI.webPanelHide();
      window.electronAPI.removeListener('web-panel-url-updated', () => {});
      window.electronAPI.removeListener('web-panel-loading', () => {});
    };
  }, []);

  const handleNavigate = useCallback((targetUrl: string) => {
    window.electronAPI.webPanelNavigate(targetUrl);
    inputRef.current?.blur();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleNavigate(inputValue);
    }
  };

  const handleBookmarkClick = useCallback((bookmarkUrl: string) => {
    handleNavigate(bookmarkUrl);
  }, [handleNavigate]);

  const handleBookmarksUpdated = useCallback(() => {
    window.electronAPI.getWebBookmarks().then(setBookmarks);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Navigation Bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0"
          onClick={() => window.electronAPI.webPanelGoBack()}
          title="Back"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0"
          onClick={() => window.electronAPI.webPanelGoForward()}
          title="Forward"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0"
          onClick={() => window.electronAPI.webPanelReload()}
          title="Reload"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCw className="h-4 w-4" />
          )}
        </Button>
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={(e) => e.target.select()}
          placeholder="Enter URL..."
          className="h-8 text-sm"
        />
      </div>

      {/* Bookmark Bar */}
      {bookmarks && (
        <BookmarkBar
          config={bookmarks}
          onNavigate={handleBookmarkClick}
          onBookmarksUpdated={handleBookmarksUpdated}
        />
      )}

      {/* BrowserView renders on top of this area — keep it empty */}
      <div className="flex-1" />
    </div>
  );
};

export default WebPanel;
