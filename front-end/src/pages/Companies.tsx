import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import Layout from "@/components/Layout";
import { useCompanies } from "@/lib/jobStore";

const Companies = () => {
  const [search, setSearch] = useState("");
  const { companies, isLoading: loading } = useCompanies();

  const filtered = companies.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="pt-28 md:pt-36 lg:pt-20">
        <div className="bg-muted border-b border-border">
          <div className="container py-8">
            <h1 className="font-heading text-3xl font-bold mb-2">Companies</h1>
            <p className="text-sm text-muted-foreground mb-6">Discover top employers with active job postings</p>
            <div className="flex bg-background rounded-xl border border-border overflow-hidden max-w-lg">
              <div className="flex items-center flex-1 px-4 gap-3">
                <Search className="text-muted-foreground w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search companies..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 py-3 bg-transparent text-sm focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="container py-8">
          {loading ? (
            <div className="text-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading companies...</p>
            </div>
          ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((company, i) => (
              <motion.div
                key={company.name}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Link
                  to={`/jobs?q=${encodeURIComponent(company.name)}`}
                  className="bg-card border border-border rounded-xl p-5 hover-lift flex items-center gap-4 block"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary font-heading font-bold flex items-center justify-center text-lg">
                    {company.name[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-heading font-semibold truncate">{company.name}</h3>
                  </div>
                  <span className="text-xs font-medium text-primary whitespace-nowrap">{company.count} jobs</span>
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

export default Companies;
