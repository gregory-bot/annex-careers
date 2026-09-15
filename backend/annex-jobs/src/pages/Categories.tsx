import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import Layout from "@/components/Layout";
import { useJobs } from "@/lib/jobStore";
import { useMemo } from "react";

/** Capitalize a tag/category nicely */
function formatTag(tag: string): string {
  const lower = tag.trim().toLowerCase();
  const acronyms: Record<string, string> = {
    ai: "AI", api: "API", aws: "AWS", git: "Git", ui: "UI", ux: "UX",
    hr: "HR", it: "IT", qa: "QA", seo: "SEO", crm: "CRM", erp: "ERP",
    devops: "DevOps", saas: "SaaS",
  };
  if (acronyms[lower]) return acronyms[lower];
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const Categories = () => {
  const { jobs, loading } = useJobs();

  const { categories, jobTypes } = useMemo(() => {
    const catMap: Record<string, number> = {};
    const typeMap: Record<string, number> = {};
    jobs.forEach((job) => {
      const cat = job.category;
      if (cat) {
        cat.split(",").forEach((c) => {
          const trimmed = c.trim().toLowerCase();
          if (trimmed) catMap[trimmed] = (catMap[trimmed] || 0) + 1;
        });
      }
      if (job.type) typeMap[job.type] = (typeMap[job.type] || 0) + 1;
    });
    return {
      categories: Object.entries(catMap)
        .map(([name, jobCount]) => ({ name, jobCount }))
        .sort((a, b) => b.jobCount - a.jobCount),
      jobTypes: Object.entries(typeMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [jobs]);
  return (
    <Layout>
      <div className="pt-28 md:pt-36 lg:pt-20">
        <div className="bg-muted border-b border-border">
          <div className="container py-8 px-4">
            <h1 className="font-heading text-3xl font-bold mb-2">Categories</h1>
            <p className="text-sm text-muted-foreground">Explore job categories and employment types</p>
          </div>
        </div>

        <div className="container py-8">
          {loading ? (
            <div className="text-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading categories...</p>
            </div>
          ) : (
            <>
              <h2 className="font-heading text-xl font-bold mb-6">Job Categories</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
            {categories.map((cat, i) => (
              <motion.div
                key={cat.name}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Link
                  to={`/jobs?cat=${encodeURIComponent(cat.name)}`}
                 className="bg-card border border-border rounded-xl p-5 hover-lift flex flex-col items-center text-center block"
                 >
                   <h3 className="font-heading font-semibold text-sm sm:text-base">{formatTag(cat.name)}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{cat.jobCount} jobs</p>
                </Link>
              </motion.div>
            ))}
          </div>

          <h2 className="font-heading text-xl font-bold mb-6">Employment Types</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {jobTypes.map((type, i) => (
              <motion.div
                key={type.name}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Link
                  to={`/jobs?type=${encodeURIComponent(type.name)}`}
                  className="bg-card border border-border rounded-xl p-5 text-center hover-lift block"
                >
                  <p className="font-heading font-bold text-2xl text-primary">{type.count}</p>
                  <p className="text-sm font-medium mt-1 capitalize">{type.name}</p>
                </Link>
              </motion.div>
            ))}
          </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default Categories;
