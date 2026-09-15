import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import Layout from "@/components/Layout";
import { useJobs } from "@/lib/jobStore";
import { useMemo } from "react";

/** Returns true if this looks like a real geographic location */
function isValidLocation(loc: string): boolean {
  if (!loc || loc.length < 2) return false;
  if (/KSh|USD|\$|KES/i.test(loc)) return false;
  if (/\d{2,},\d{3}/.test(loc)) return false;
  if (/^confidential$/i.test(loc.trim())) return false;
  if (/full.?time|part.?time|contract|internship|education/i.test(loc)) return false;
  if (/^\d+[\s\-,\d]*$/.test(loc)) return false;
  if (!/[a-zA-Z]/.test(loc)) return false;
  return true;
}

const Locations = () => {
  const { jobs, loading } = useJobs();

  const locations = useMemo(() => {
    const map: Record<string, { name: string; jobCount: number }> = {};
    jobs.forEach((job) => {
      if (!job.location || !isValidLocation(job.location)) return;
      const loc = job.location.trim();
      if (!map[loc]) {
        map[loc] = { name: loc, jobCount: 0 };
      }
      map[loc].jobCount++;
    });
    return Object.values(map).sort((a, b) => b.jobCount - a.jobCount);
  }, [jobs]);
  return (
    <Layout>
      <div className="pt-28 md:pt-36 lg:pt-20">
        <div className="bg-muted border-b border-border">
          <div className="container py-8">
            <h1 className="font-heading text-3xl font-bold mb-2">Locations</h1>
            <p className="text-sm text-muted-foreground">Browse jobs by city or region across Kenya</p>
          </div>
        </div>

        <div className="container py-8">
          {loading ? (
            <div className="text-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading locations...</p>
            </div>
          ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {locations.map((loc, i) => (
              <motion.div
                key={loc.name}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Link
                  to={`/jobs?q=${encodeURIComponent(loc.name)}`}
                  className="bg-card border border-border rounded-xl p-6 hover-lift flex flex-col items-center text-center block"
                >
                  <h3 className="font-heading font-semibold text-lg">{loc.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{loc.jobCount} active jobs</p>
                </Link>
              </motion.div>
            ))}
          </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default Locations;
