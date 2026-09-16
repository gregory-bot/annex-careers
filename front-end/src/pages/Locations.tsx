import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import Layout from "@/components/Layout";
import { useLocations } from "@/lib/jobStore";
import { isValidLocation } from "@/lib/locationUtils";

const Locations = () => {
  const { locations: rawLocations, isLoading: loading } = useLocations();
  const locations = rawLocations.filter((l) => isValidLocation(l.name));

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
                  <p className="text-sm text-muted-foreground mt-1">{loc.count} active jobs</p>
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
