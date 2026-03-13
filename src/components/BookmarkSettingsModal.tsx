import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Plus, Trash2, GripVertical } from 'lucide-react';

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

interface BookmarkSettingsModalProps {
  open: boolean;
  config: BookmarkConfig;
  onClose: () => void;
  onSave: (config: BookmarkConfig) => void;
}

const BookmarkSettingsModal: React.FC<BookmarkSettingsModalProps> = ({ open, config, onClose, onSave }) => {
  const [categories, setCategories] = useState<BookmarkCategory[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');

  useEffect(() => {
    if (open) {
      setCategories(JSON.parse(JSON.stringify(config.bookmarks)));
    }
  }, [open, config]);

  const addCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    setCategories([...categories, { category: name, items: [] }]);
    setNewCategoryName('');
  };

  const removeCategory = (idx: number) => {
    setCategories(categories.filter((_, i) => i !== idx));
  };

  const addBookmark = (catIdx: number) => {
    const updated = [...categories];
    updated[catIdx].items.push({ label: '', url: '', icon: 'monitor' });
    setCategories(updated);
  };

  const updateBookmark = (catIdx: number, itemIdx: number, field: keyof Bookmark, value: string) => {
    const updated = [...categories];
    updated[catIdx].items[itemIdx] = { ...updated[catIdx].items[itemIdx], [field]: value };
    setCategories(updated);
  };

  const removeBookmark = (catIdx: number, itemIdx: number) => {
    const updated = [...categories];
    updated[catIdx].items.splice(itemIdx, 1);
    setCategories(updated);
  };

  const handleSave = () => {
    // Filter out empty bookmarks
    const cleaned = categories.map((cat) => ({
      ...cat,
      items: cat.items.filter((item) => item.label.trim() && item.url.trim()),
    }));
    onSave({ bookmarks: cleaned });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Bookmarks</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {categories.map((cat, catIdx) => (
            <div key={catIdx} className="border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-sm">{cat.category}</h4>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => addBookmark(catIdx)}>
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => removeCategory(catIdx)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {cat.items.map((item, itemIdx) => (
                  <div key={itemIdx} className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0 cursor-grab" />
                    <Input
                      value={item.label}
                      onChange={(e) => updateBookmark(catIdx, itemIdx, 'label', e.target.value)}
                      placeholder="Label"
                      className="h-8 text-sm w-28"
                    />
                    <Input
                      value={item.url}
                      onChange={(e) => updateBookmark(catIdx, itemIdx, 'url', e.target.value)}
                      placeholder="https://..."
                      className="h-8 text-sm flex-1"
                    />
                    <select
                      value={item.icon}
                      onChange={(e) => updateBookmark(catIdx, itemIdx, 'icon', e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="monitor">Monitor</option>
                      <option value="mri">MRI</option>
                      <option value="alert">Alert</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 flex-shrink-0 text-destructive"
                      onClick={() => removeBookmark(catIdx, itemIdx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Add Category */}
          <div className="flex items-center gap-2">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="New category name..."
              className="h-8 text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }}
            />
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={addCategory}>
              <Plus className="h-3 w-3 mr-1" /> Category
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BookmarkSettingsModal;
