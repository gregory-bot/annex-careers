import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API_BASE } from "@/lib/jobStore";

const Footer = () => {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || submitting) return;

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Something went wrong");
      }
      
      toast.success("Welcome email sent! Check your inbox for today's top jobs.");
      setEmail("");
    } catch (err: any) {
      toast.error(err.message || "Failed to subscribe. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <footer className="bg-surface-dark text-surface-dark-foreground">
      {/* Subscribe section */}
      <div className="container py-10 sm:py-12 px-4">
        <div className="max-w-xl mx-auto text-center">
          <Mail className="w-8 h-8 sm:w-10 sm:h-10 text-primary mx-auto mb-3 sm:mb-4" />
          <h3 className="font-heading text-xl sm:text-2xl font-bold mb-2">Get Daily Job Alerts</h3>
          <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flex-1 px-4 py-3 rounded-lg bg-surface-dark-foreground/10 border border-surface-dark-foreground/20 text-surface-dark-foreground placeholder:text-surface-dark-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            />
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 transition-opacity shrink-0 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</> : "Subscribe"}
            </button>
          </form>
        </div>
      </div>

      <div className="border-t border-surface-dark-foreground/10">
        <div className="container py-8 sm:py-10 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 px-4">
          <div>
            <h4 className="font-heading font-bold text-lg mb-3 sm:mb-4">
              <span className="text-primary">Annex</span>
            </h4>
            <p className="text-sm text-surface-dark-foreground/60">
              Aggregating the best job opportunities from multiple sources across Kenya.
            </p>
          </div>
          <div>
            <h5 className="font-semibold text-sm mb-3">Platform</h5>
            <div className="flex flex-col gap-2 text-sm text-surface-dark-foreground/60">
              <Link to="/jobs" className="hover:text-primary transition-colors">Jobs</Link>
              <Link to="/companies" className="hover:text-primary transition-colors">Companies</Link>
              <Link to="/locations" className="hover:text-primary transition-colors">Locations</Link>
              <Link to="/categories" className="hover:text-primary transition-colors">Categories</Link>
            </div>
          </div>
          <div>
            <h5 className="font-semibold text-sm mb-3">Company</h5>
            <div className="flex flex-col gap-2 text-sm text-surface-dark-foreground/60">
              <Link to="/about" className="hover:text-primary transition-colors">About</Link>
              <a href="#" className="hover:text-primary transition-colors">Privacy</a>
              <a href="#" className="hover:text-primary transition-colors">Terms</a>
              <a href="#" className="hover:text-primary transition-colors">Contact</a>
            </div>
          </div>
          <div>
            <h5 className="font-semibold text-sm mb-3">Sources</h5>
            <div className="flex flex-col gap-2 text-sm text-surface-dark-foreground/60">
              <span>LinkedIn</span>
              <span>BrighterMonday</span>
              <span>Indeed</span>
              <span>RemoteOK</span>
              <span>Remotive</span>
              <span>MyJobMag</span>
              <span>+ 20 more</span>
            </div>
          </div>
        </div>
        <div className="container pb-6 px-4">
          <div className="border-t border-surface-dark-foreground/10 pt-6 text-center">
            <p className="text-sm text-surface-dark-foreground/60">
              Data pipeline by{" "}
              <a href="https://gregory.co.ke/" target="_blank" rel="noopener noreferrer" className="text-white font-bold hover:underline">Gregory</a>{" "}
              and{" "}
              <a href="https://github.com/mainamuragev" target="_blank" rel="noopener noreferrer" className="text-white font-bold hover:underline">Maina</a>.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;