import React, { useState, useEffect } from 'react';
import { ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface PreviewData {
  title: string;
  description: string;
  image: string;
  status: number;
  url: string;
}

export const LinkPreview: React.FC<{ url: string }> = ({ url }) => {
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPreview = async () => {
      try {
        const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error("Link preview fetch failed", err);
      } finally {
        setLoading(false);
      }
    };

    if (url.startsWith('http')) {
      fetchPreview();
    } else {
      setLoading(false);
    }
  }, [url]);

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase italic bg-accent-bg px-3 py-1.5 border-2 border-ink shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-none mb-2">
        <Loader2 className="w-4 h-4 animate-spin text-active" />
        Processing_Data_Sync...
      </div>
    );
  }

  if (!data || (data.status >= 500 && !data.title)) {
    return (
      <a 
        href={url} 
        target="_blank" 
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-pop-pink font-black italic hover:scale-105 transition-transform origin-left mb-2"
      >
        <AlertCircle className="w-4 h-4" />
        <span className="line-through">{url}</span>
        <span className="text-[9px] font-black bg-pop-pink text-white px-2 py-0.5 border-2 border-ink shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] uppercase -rotate-2">LINK_UNREACHABLE</span>
      </a>
    );
  }

  // If status is 403 or ENOTFOUND (which we handle as 500 on server with a partial payload), we still have a title (hostname)
  const isRestricted = data.status === 403 || (data as any).isRestricted;

  return (
    <div className="my-6 group max-w-xl">
      <a 
        href={url} 
        target="_blank" 
        rel="noopener noreferrer"
        className="block border-4 border-ink bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-2 hover:translate-y-2 transition-all overflow-hidden"
      >
        <div className="flex flex-col md:flex-row">
          {(data.image && !isRestricted) ? (
            <div className="w-full md:w-40 h-40 md:h-auto overflow-hidden border-b-4 md:border-b-0 md:border-r-4 border-ink shrink-0 bg-accent-bg">
              <img 
                src={data.image} 
                alt={data.title} 
                className="w-full h-full object-cover grayscale contrast-125 group-hover:grayscale-0 group-hover:scale-110 transition-all duration-700"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <div className="w-full md:w-20 h-20 md:h-auto border-b-4 md:border-b-0 md:border-r-4 border-ink flex items-center justify-center bg-accent-bg shrink-0">
               <ExternalLink className="w-8 h-8 opacity-20" />
            </div>
          )}
          <div className="p-5 flex flex-col gap-2 min-w-0 flex-1">
            <div className="flex items-center justify-between gap-4">
              <h4 className="text-sm font-black uppercase italic tracking-tighter group-hover:text-active transition-colors line-clamp-1">
                {data.title}
                {isRestricted && <span className="ml-2 text-[8px] bg-pop-pink text-white px-1 not-italic">LOCKED</span>}
              </h4>
              <ExternalLink className="w-4 h-4 shrink-0 text-active" />
            </div>
            <p className="text-[10px] font-black uppercase opacity-60 line-clamp-2 leading-tight italic">
              {isRestricted ? "Anti-scraping protection active. Hover to visit source directly." : `"${data.description}"`}
            </p>
            <div className="flex items-center gap-2 mt-auto">
              <span className="text-[8px] font-black bg-pop-cyan text-white px-2 py-0.5 border-2 border-ink rotate-1 uppercase">EXTERNAL_DOC</span>
              <span className="text-[8px] font-black opacity-30 truncate flex-1">{url}</span>
            </div>
          </div>
        </div>
      </a>
    </div>
  );
};
