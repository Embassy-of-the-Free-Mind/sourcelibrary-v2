'use client';

import { useEffect, useState } from 'react';
import { Languages, X } from 'lucide-react';

declare global {
  interface Window {
    google: {
      translate: {
        TranslateElement: new (
          options: { pageLanguage: string; includedLanguages?: string; layout?: number },
          elementId: string
        ) => void;
      };
    };
    googleTranslateElementInit: () => void;
  }
}

export function GoogleTranslate() {
  const [enabled, setEnabled] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || scriptLoaded || typeof window === 'undefined') return;

    // Check if script is already loaded
    if (document.getElementById('google-translate-script')) {
      setScriptLoaded(true);
      return;
    }

    // Define the callback before loading the script
    window.googleTranslateElementInit = () => {
      new window.google.translate.TranslateElement(
        {
          pageLanguage: 'en',
          // Popular languages for historical text readers
          includedLanguages: 'nl,de,fr,es,it,pt,pl,ru,ja,zh-CN,ko,ar,he',
          layout: 2, // SIMPLE layout
        },
        'google_translate_element'
      );
    };

    // Load the Google Translate script
    const script = document.createElement('script');
    script.id = 'google-translate-script';
    script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    script.async = true;
    document.body.appendChild(script);

    setScriptLoaded(true);
  }, [enabled, scriptLoaded]);

  // Reset translation by removing the Google Translate cookie and reloading
  const disableTranslation = () => {
    // Remove Google Translate cookies
    document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.' + window.location.hostname;
    setEnabled(false);
    // Reload to reset the page to English
    window.location.reload();
  };

  if (!enabled) {
    return (
      <button
        onClick={() => setEnabled(true)}
        className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-amber-600 transition-colors"
        title="Translate to other languages"
      >
        <Languages className="w-4 h-4" />
        <span>Translate</span>
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-2">
      <Languages className="w-4 h-4 text-amber-600" />
      <div id="google_translate_element" className="google-translate-wrapper" />
      <button
        onClick={disableTranslation}
        className="p-1 text-stone-400 hover:text-stone-600 rounded transition-colors"
        title="Disable translation"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <style jsx global>{`
        /* Hide Google Translate branding and simplify */
        .google-translate-wrapper .goog-te-gadget {
          font-family: inherit !important;
          font-size: 14px !important;
        }
        .google-translate-wrapper .goog-te-gadget-simple {
          background: transparent !important;
          border: none !important;
          padding: 0 !important;
        }
        .google-translate-wrapper .goog-te-gadget-simple .goog-te-menu-value {
          color: #57534e !important;
        }
        .google-translate-wrapper .goog-te-gadget-simple .goog-te-menu-value:hover {
          color: #d97706 !important;
        }
        .google-translate-wrapper .goog-te-gadget-simple .goog-te-menu-value span {
          color: inherit !important;
        }
        .google-translate-wrapper .goog-te-gadget-icon {
          display: none !important;
        }
        .google-translate-wrapper .goog-te-gadget-simple img {
          display: none !important;
        }
        /* Hide the "Powered by Google" text */
        .google-translate-wrapper .goog-te-gadget span {
          display: none !important;
        }
        .google-translate-wrapper .goog-te-gadget-simple .goog-te-menu-value span:first-child {
          display: inline !important;
        }
        /* Fix the dropdown arrow */
        .google-translate-wrapper .goog-te-gadget-simple .goog-te-menu-value span:last-child {
          display: inline !important;
          margin-left: 4px;
        }
        /* Hide the Google Translate banner */
        .goog-te-banner-frame {
          display: none !important;
        }
        body {
          top: 0 !important;
        }
      `}</style>
    </div>
  );
}
