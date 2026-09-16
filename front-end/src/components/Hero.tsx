import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

// Optimised image URLs — compressed, resized for web
const heroImages = [
  // ↓ was missing compress/resize params — meant this was the ONE image
  // loaded eagerly (blocking the whole hero) that shipped at full
  // original resolution instead of the optimized ~1280px/q60 variant.
  "https://images.pexels.com/photos/23496636/pexels-photo-23496636.jpeg?auto=compress&cs=tinysrgb&w=1280&q=60",
  "https://images.pexels.com/photos/7520156/pexels-photo-7520156.jpeg?auto=compress&cs=tinysrgb&w=1280&q=60",
  "https://images.pexels.com/photos/6632497/pexels-photo-6632497.jpeg?auto=compress&cs=tinysrgb&w=1280&q=60",
];

const SLIDE_INTERVAL = 10000;
const FADE_MS = 10000;

/** Preload an image and return a promise */
function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve(); // don't block on failure
    img.src = src;
  });
}

const Hero = () => {
  const [current, setCurrent] = useState(0);
  const [loaded, setLoaded] = useState<boolean[]>(() => heroImages.map(() => false));
  const [ready, setReady] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  // Preload all images on mount
  useEffect(() => {
    let cancelled = false;

    // Load the first image ASAP, then the rest in parallel
    preloadImage(heroImages[0]).then(() => {
      if (cancelled) return;
      setLoaded((prev) => { const n = [...prev]; n[0] = true; return n; });
      setReady(true);
    });

    // Preload remaining images in background
    heroImages.slice(1).forEach((src, i) => {
      preloadImage(src).then(() => {
        if (cancelled) return;
        setLoaded((prev) => { const n = [...prev]; n[i + 1] = true; return n; });
      });
    });

    return () => { cancelled = true; };
  }, []);

  // Auto-advance slides only when first image is loaded
  useEffect(() => {
    if (!ready) return;
    timerRef.current = setInterval(() => {
      setCurrent((prev) => (prev + 1) % heroImages.length);
    }, SLIDE_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [ready]);

  // Memoised to avoid re-creating on each render
  const handleImgLoad = useCallback((idx: number) => {
    setLoaded((prev) => {
      if (prev[idx]) return prev;
      const n = [...prev]; n[idx] = true; return n;
    });
  }, []);

  return (
    <section className="relative h-[65vh] sm:h-[72vh] md:h-[80vh] lg:h-[88vh] min-h-[380px] sm:min-h-[440px] flex items-center justify-center overflow-hidden">

      {/* Placeholder gradient shown until first image loads — subtly
          animated so a slow connection reads as "loading", not stuck */}
      <div
        className={`absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 transition-opacity duration-700 ${
          ready ? "opacity-0" : "opacity-100 animate-pulse"
        }`}
      />

      {/* All images stacked — only current one has opacity-100 */}
      {heroImages.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          onLoad={() => handleImgLoad(i)}
          decoding={i === 0 ? "sync" : "async"}
          // Use lowercase "fetchpriority" to avoid React DOM warning
          {...{ fetchpriority: i === 0 ? "high" : "low" }}
          loading={i === 0 ? "eager" : "lazy"}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity ease-in-out ${
            i === current && loaded[i] ? "opacity-100" : "opacity-0"
          }`}
          style={{ transitionDuration: `${FADE_MS}ms` }}
        />
      ))}

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-foreground/60" />

      {/* Content */}
      <div className="relative z-10 container text-center px-4">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="font-heading text-2xl sm:text-3xl md:text-4xl lg:text-6xl font-bold text-white mb-4 sm:mb-6 leading-tight"
        >
          Find your next opportunity
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="flex items-center justify-center gap-3 sm:gap-4 mt-4 sm:mt-8 flex-wrap"
        >
          <Link
            to="/jobs"
            className="px-5 sm:px-6 py-2.5 sm:py-3 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:opacity-90 transition-opacity"
          >
            Browse All Jobs
          </Link>
          <Link
            to="/about"
            className="px-5 sm:px-6 py-2.5 sm:py-3 border border-white/30 text-white rounded-xl font-medium text-sm hover:bg-white/10 transition-colors"
          >
            How It Works
          </Link>
        </motion.div>
      </div>


    </section>
  );
};

export default Hero;