import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, Search } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const navItems = [
  { label: "Home", path: "/" },
  { label: "Jobs", path: "/jobs" },
  { label: "Contracts", path: "/contracts" },
  { label: "Companies", path: "/companies" },
  { label: "Locations", path: "/locations" },
  { label: "Categories", path: "/categories" },
  { label: "Chat", path: "/chat" },
  { label: "About", path: "/about" },
];

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const location = useLocation();
  const navRef = useRef<HTMLDivElement>(null);

  const isHome = location.pathname === "/";

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mobileOpen]);

  const showDarkText = scrolled || !isHome;

  const handleSearch = () => {
    if (searchQuery.trim()) {
      window.location.href = `/jobs?q=${encodeURIComponent(searchQuery)}`;
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          showDarkText
            ? "bg-background/95 backdrop-blur-md shadow-sm"
            : "bg-transparent"
        }`}
      >
        <div className="container px-4">
          {/* Top row - Logo and Desktop Search */}
          <div className="flex items-center justify-between h-16 gap-3 sm:gap-4">
            {/* Logo */}
            <Link to="/" className="font-heading text-2xl font-bold tracking-tight shrink-0">
              <span className="text-primary font-extrabold">Annex</span>
            </Link>

            {/* Desktop Search Bar (hidden on md below) */}
            <div className="hidden lg:flex flex-1 max-w-sm items-center gap-0 bg-white backdrop-blur-md rounded-xl overflow-hidden border border-muted/50">
              <div className="flex items-center flex-1 px-3 sm:px-4 gap-2 min-w-0">
                <Search className="text-muted-foreground w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                <input
                  type="text"
                  placeholder="Search jobs, companies..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="flex-1 py-2.5 bg-white text-foreground placeholder:text-muted-foreground focus:outline-none text-sm min-w-0"
                />
              </div>
              <button
                onClick={handleSearch}
                className="px-4 sm:px-6 py-2.5 bg-primary text-primary-foreground font-semibold text-xs sm:text-sm hover:opacity-90 transition-opacity shrink-0"
              >
                Search
              </button>
            </div>

            {/* Desktop nav items */}
            <div className="hidden lg:flex items-center gap-6">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`text-sm font-semibold transition-colors hover:text-primary whitespace-nowrap ${
                    location.pathname === item.path
                      ? "text-primary"
                      : showDarkText ? "text-foreground" : "text-white"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>

            {/* Mobile hamburger */}
            <button
              className="lg:hidden w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-lg shrink-0"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>

          {/* Tablet/Laptop Search Bar (md to lg) */}
          <div className="hidden md:flex lg:hidden pb-3">
            <div className="flex items-center gap-0 bg-white backdrop-blur-md rounded-xl overflow-hidden border border-muted/50 w-full">
              <div className="flex items-center flex-1 px-3 gap-2 min-w-0">
                <Search className="text-muted-foreground w-4 h-4 shrink-0" />
                <input
                  type="text"
                  placeholder="Search jobs, companies..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="flex-1 py-2.5 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none text-sm min-w-0"
                />
              </div>
              <button
                onClick={handleSearch}
                className="px-4 py-2.5 bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity shrink-0"
              >
                Search
              </button>
            </div>
          </div>

          {/* Tablet nav items (md to lg) */}
          <div className="hidden md:flex lg:hidden items-center gap-2 pb-3 overflow-x-auto">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`text-xs font-semibold transition-colors hover:text-primary whitespace-nowrap px-2 py-1 rounded ${
                  location.pathname === item.path
                    ? "text-primary"
                    : showDarkText ? "text-foreground" : "text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Mobile Search Bar (sm below) */}
          <div className="md:hidden pb-3">
            <div className="flex items-center gap-0 bg-white backdrop-blur-md rounded-lg overflow-hidden border border-muted/50">
              <div className="flex items-center flex-1 px-3 gap-2 min-w-0">
                <Search className="text-muted-foreground w-4 h-4 shrink-0" />
                <input
                  type="text"
                  placeholder="Search jobs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="flex-1 py-2 bg-white text-foreground placeholder:text-muted-foreground focus:outline-none text-xs min-w-0"
                />
              </div>
              <button
                onClick={handleSearch}
                className="px-3 py-2 bg-primary text-primary-foreground font-semibold text-xs hover:opacity-90 transition-opacity shrink-0"
              >
                Go
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile sidebar from left */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-foreground/40 backdrop-blur-sm z-40 md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.nav
              ref={navRef}
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed top-0 left-0 bottom-0 w-72 z-50 bg-background shadow-2xl p-6 pt-8 md:hidden flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <Link to="/" onClick={() => setMobileOpen(false)} className="font-heading text-2xl font-bold tracking-tight">
                  <span className="text-primary font-extrabold">Annex</span>
                </Link>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-foreground"
                  aria-label="Close menu"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex flex-col gap-1 flex-1">
                {navItems.map((item, i) => (
                  <motion.div
                    key={item.path}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <Link
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      className={`block px-4 py-3 rounded-xl text-base font-medium transition-colors ${
                        location.pathname === item.path
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted text-foreground"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default Navbar;