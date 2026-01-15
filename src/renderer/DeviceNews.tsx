import React, { useRef, useCallback, useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Calendar, Loader2, Link } from 'lucide-react';
import { cn } from '@/lib/utils';

// Fallback Images
import warningSvg from './assets/news_fallbacks/warning.svg';
import studySvg from './assets/news_fallbacks/study.svg';
import newsSvg from './assets/news_fallbacks/news.svg';

interface NewsItem {
    id: string;
    type: 'news' | 'warning' | 'study';
    title: string;
    summary: string;
    source: string;
    date: string;
    url: string;
    imageUrl?: string;
}

const ITEMS_PER_PAGE = 9;

const NewsCard: React.FC<{ item: NewsItem; forwardRef?: React.Ref<HTMLDivElement> }> = ({ item, forwardRef }) => {
    // Determine initial Source: use imported SVG if no image provided
    const getFallback = (type: string) => {
        switch (type) {
            case 'warning': return warningSvg;
            case 'study': return studySvg;
            default: return newsSvg;
        }
    };

    const [imgSrc, setImgSrc] = useState<string>(item.imageUrl || getFallback(item.type));

    return (
        <div ref={forwardRef}>
            <Card className="flex flex-row h-48 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 overflow-hidden group border-muted/60 bg-card/50 backdrop-blur-sm">
                {/* Image Area - 100% Image based, no DIV fallbacks */}
                <div className="w-1/3 h-full relative overflow-hidden flex-shrink-0">
                    <img
                        src={imgSrc}
                        alt={item.title}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                        onError={() => {
                            // If load fails, swap to fallback SVG
                            const fallback = getFallback(item.type);
                            if (imgSrc !== fallback) {
                                setImgSrc(fallback);
                            }
                        }}
                    />

                    <div className="absolute top-2 left-2">
                        <Badge variant={
                            item.type === 'warning' ? 'destructive' :
                                item.type === 'study' ? 'secondary' : 'default'
                        } className={cn(
                            "uppercase text-[10px] tracking-wider shadow-sm opacity-90 backdrop-blur-md",
                            item.type === 'warning' && "bg-red-500/90 hover:bg-red-500 text-white",
                            item.type === 'study' && "bg-blue-500/90 hover:bg-blue-500 text-white",
                            item.type === 'news' && "bg-emerald-500/90 hover:bg-emerald-500 text-white"
                        )}>
                            {item.type}
                        </Badge>
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex flex-col flex-1 p-4">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
                        <Calendar className="h-3 w-3" />
                        {item.date}
                        <span>•</span>
                        <span className="font-medium text-foreground/80 truncate max-w-[120px]" title={item.source}>{item.source}</span>
                    </div>

                    <h3 className="text-lg font-bold leading-tight mb-2 group-hover:text-primary transition-colors line-clamp-2">
                        {item.title}
                    </h3>

                    <p className="text-muted-foreground text-xs leading-relaxed line-clamp-3 mb-auto">
                        {item.summary}
                    </p>

                    <div className="pt-2 mt-2 border-t flex justify-end">
                        <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs font-medium text-primary hover:text-primary/80 group/btn"
                            onClick={() => window.open(item.url, '_blank')}
                        >
                            Read more <ExternalLink className="h-3 w-3 ml-1 transition-transform group-hover/btn:translate-x-0.5" />
                        </Button>
                    </div>
                </div>
            </Card>
        </div>
    );
};

const DeviceNews: React.FC = () => {
    const [allNews, setAllNews] = React.useState<NewsItem[]>([]);
    const [visibleNews, setVisibleNews] = React.useState<NewsItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [statusMessage, setStatusMessage] = React.useState('Initializing...');
    const [page, setPage] = React.useState(1);

    // For infinite scroll
    const observer = useRef<IntersectionObserver | null>(null);
    const lastNewsElementRef = useCallback((node: HTMLDivElement | null) => {
        if (loading) return;
        if (observer.current) observer.current.disconnect();

        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && visibleNews.length < allNews.length) {
                // Load more
                setPage(prevPage => prevPage + 1);
            }
        });

        if (node) observer.current.observe(node);
    }, [loading, visibleNews.length, allNews.length]);

    // Handle pagination updates
    React.useEffect(() => {
        const endIndex = page * ITEMS_PER_PAGE;
        setVisibleNews(allNews.slice(0, endIndex));
    }, [page, allNews]);

    React.useEffect(() => {
        // Listen for status updates
        try {
            if (window.electronAPI && window.electronAPI.onNewsStatus) {
                window.electronAPI.onNewsStatus((msg: string) => {
                    setStatusMessage(msg);
                });
            }
        } catch (e) {
            console.warn('Status listener not supported');
        }

        const loadNews = async () => {
            try {
                const data = await window.electronAPI.getDeviceNews();
                if (data && data.length > 0) {
                    setAllNews(data);
                    setVisibleNews(data.slice(0, ITEMS_PER_PAGE));
                } else {
                    setAllNews([]);
                }
            } catch (error) {
                console.error('Failed to load news:', error);
                setStatusMessage('Failed to load news');
            } finally {
                setLoading(false);
            }
        };
        loadNews();
    }, []);

    return (
        <div className="container mx-auto p-8 max-w-7xl h-full overflow-y-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Device News & Updates</h1>
                    <p className="text-muted-foreground mt-1">
                        Latest manufacturer warnings, clinical studies, and industry news.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    {/* Status Indicator */}
                    {loading && (
                        <div className="flex items-center text-sm text-primary animate-pulse bg-primary/10 px-3 py-1 rounded-full">
                            <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                            {statusMessage}
                        </div>
                    )}

                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => window.open('https://pubmed.ncbi.nlm.nih.gov/', '_blank')}>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open PubMed
                        </Button>
                    </div>
                </div>
            </div>

            {loading && visibleNews.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-4 text-muted-foreground/50">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary/30"></div>
                    <p className="text-lg font-medium">{statusMessage}</p>
                </div>
            ) : visibleNews.length === 0 ? (
                <div className="text-center py-20 bg-muted/10 rounded-xl border border-dashed border-muted">
                    <Link className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <h3 className="text-lg font-medium">No News Found</h3>
                    <p className="text-muted-foreground">Could not fetch updates at this time. Check your internet connection.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-8">
                    {visibleNews.map((item, index) => {
                        const isLastElement = index === visibleNews.length - 1;
                        return (
                            <NewsCard
                                key={item.id}
                                item={item}
                                forwardRef={isLastElement ? lastNewsElementRef : undefined}
                            />
                        );
                    })}

                    {/* Loading indicator for infinite scroll */}
                    {visibleNews.length < allNews.length && (
                        <div className="col-span-full flex justify-center py-4">
                            <div className="flex items-center gap-2 text-muted-foreground text-sm animate-pulse">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading more updates...
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default DeviceNews;
