import React, { useState } from 'react';
import { Button } from './ui/button';
import { Monitor, ShieldAlert, Magnet, Settings2 } from 'lucide-react';
import BookmarkSettingsModal from './BookmarkSettingsModal';

interface Bookmark {
  label: string;
  url: string;
  icon: string;
}

interface BookmarkCategory {
  category: string;
  items: Bookmark[];
}

interface BookmarkConfig {
  bookmarks: BookmarkCategory[];
}

interface BookmarkBarProps {
  config: BookmarkConfig;
  onNavigate: (url: string) => void;
  onBookmarksUpdated: () => void;
}

const iconMap: Record<string, React.ReactNode> = {
  monitor: <Monitor className="h-3 w-3" />,
  mri: <Magnet className="h-3 w-3" />,
  alert: <ShieldAlert className="h-3 w-3" />,
};

const BookmarkBar: React.FC<BookmarkBarProps> = ({ config, onNavigate, onBookmarksUpdated }) => {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-card/50 overflow-x-auto">
        {config.bookmarks.map((category) => (
          <React.Fragment key={category.category}>
            {category.items.map((item) => (
              <Button
                key={item.url}
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1 flex-shrink-0"
                onClick={() => onNavigate(item.url)}
                title={`${item.label} — ${category.category}`}
              >
                {iconMap[item.icon] || <Monitor className="h-3 w-3" />}
                {item.label}
              </Button>
            ))}
            <div className="w-px h-4 bg-border flex-shrink-0" />
          </React.Fragment>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 flex-shrink-0 ml-auto"
          onClick={() => setSettingsOpen(true)}
          title="Manage bookmarks"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <BookmarkSettingsModal
        open={settingsOpen}
        config={config}
        onClose={() => setSettingsOpen(false)}
        onSave={(newConfig) => {
          window.electronAPI.setWebBookmarks(newConfig).then(() => {
            onBookmarksUpdated();
            setSettingsOpen(false);
          });
        }}
      />
    </>
  );
};

export default BookmarkBar;
