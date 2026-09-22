import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import Layout from "@/components/Layout";
import AdBanner from "@/components/AdBanner";
import { useDocumentMeta } from "@/lib/seo";
import Hero from "@/components/Hero";
import JobCard from "@/components/JobCard";
import { useJobs, useStats, useCategories, useLocations } from "@/lib/jobStore";
import { isValidLocation } from "@/lib/locationUtils";

/** Capitalize a tag/category nicely */
function formatTag(tag: string): string {
  const lower = tag.trim().toLowerCase();
  // Known acronyms
  const acronyms: Record<string, string> = {
    ai: "AI", api: "API", aws: "AWS", git: "Git", ui: "UI", ux: "UX",
    hr: "HR", it: "IT", qa: "QA", seo: "SEO", crm: "CRM", erp: "ERP",
    devops: "DevOps", saas: "SaaS",
  };
  if (acronyms[lower]) return acronyms[lower];
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function CardSkeleton() {
  return <div className="bg-card border border-border rounded-xl h-24 animate-pulse" />;
}

const Index = () => {
  useDocumentMeta({ title: "Annex Careers - Find Jobs in Kenya" });
  const { jobs: featuredJobs, isLoading: featuredLoading, data: featuredPage } = useJobs({ page: 1, perPage: 6 });
  const { stats: apiStats } = useStats();
  const { categories: rawCategories, isLoading: categoriesLoading } = useCategories(8);
  const { locations: rawLocations, isLoading: locationsLoading } = useLocations();

  const locations = rawLocations.filter((l) => isValidLocation(l.name)).slice(0, 6);

  const typeCounts: Record<string, number> = {};
  Object.entries(apiStats?.job_type_counts ?? {}).forEach(([name, count]) => {
    typeCounts[name.toLowerCase()] = count;
  });

  const totalJobs = apiStats?.active_jobs ?? 0;
  const fullTime = typeCounts["full-time"] || typeCounts["full time"] || 0;
  const contractJobs = typeCounts["contract"] || 0;
  const partTime = typeCounts["part-time"] || typeCounts["part time"] || 0;

  const statsCards = [
    { label: "Total Jobs", value: totalJobs },
    { label: "Remote", value: apiStats?.remote_jobs ?? 0 },
    { label: "Full-time", value: fullTime },
    { label: "Contract", value: contractJobs },
    { label: "Companies", value: apiStats?.companies ?? 0 },
    ...(partTime > 0 ? [{ label: "Part-time", value: partTime }] : []),
  ];

  return (
    <Layout>
      <Hero />
      <div className="container px-4 pt-8"><AdBanner placement="home" /></div>

      {/* Stats Cards — simple numbers, no icons */}
      <section className="container py-12 sm:py-16 px-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {statsCards.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="bg-card border border-border rounded-xl p-5 text-center"
            >
              <p className="font-heading text-3xl sm:text-4xl font-bold">{stat.value.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Featured Jobs */}
      <section className="container pb-12 sm:pb-16 px-4">
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <div>
            <h2 className="font-heading text-xl sm:text-2xl font-bold">Featured Jobs</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">Latest opportunities from Kenya &amp; worldwide</p>
          </div>
          <Link to="/jobs" className="text-sm font-medium text-primary hover:underline">
            View all →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {featuredLoading
            ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
            : featuredJobs.map((job, i) => (
                <motion.div
                  key={job.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <JobCard job={job} />
                </motion.div>
              ))}
        </div>
        {(featuredPage?.total ?? 0) > 6 && (
          <div className="text-center mt-8">
            <Link
              to="/jobs"
              className="inline-block px-8 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              View More Jobs
            </Link>
          </div>
        )}
      </section>

      {/* Browse by Category */}
      <section className="bg-muted">
        <div className="container py-12 sm:py-16 px-4">
          <h2 className="font-heading text-xl sm:text-2xl font-bold mb-6 sm:mb-8 text-center">Browse by Category</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {categoriesLoading
              ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)
              : rawCategories.map((cat, i) => (
                  <motion.div
                    key={cat.name}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Link
                      to={`/jobs?cat=${encodeURIComponent(cat.name)}`}
                      className="bg-card border border-border rounded-xl p-4 sm:p-5 flex flex-col items-center text-center hover-lift block"
                    >
                      <span className="font-heading font-semibold text-sm sm:text-base">
                        {cat.name.split(",").map(formatTag).join(" · ")}
                      </span>
                      <span className="text-xs text-muted-foreground mt-1">{cat.count} jobs</span>
                    </Link>
                  </motion.div>
                ))}
          </div>
        </div>
      </section>

      {/* Popular Locations */}
      <section className="container py-12 sm:py-16 px-4">
        <h2 className="font-heading text-xl sm:text-2xl font-bold mb-6 sm:mb-8 text-center">Popular Locations</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {locationsLoading
            ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
            : locations.map((loc, i) => (
                <motion.div
                  key={loc.name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link
                    to={`/jobs?q=${encodeURIComponent(loc.name)}`}
                    className="bg-card border border-border rounded-xl p-4 text-center hover-lift block"
                  >
                    <p className="font-heading font-semibold text-sm">{loc.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{loc.count} jobs</p>
                  </Link>
                </motion.div>
              ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary">
        <div className="container py-12 sm:py-16 text-center px-4">
          <h2 className="font-heading text-2xl sm:text-3xl font-bold text-primary-foreground mb-4">
            Find Your opportunity
          </h2>
          <p className="text-primary-foreground/80 mb-6 sm:mb-8 max-w-md mx-auto text-sm">
            We aggregate jobs from 25+ sources all in one place.
          </p>
          <Link
            to="/jobs"
            className="inline-block px-8 py-3 bg-background text-foreground rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Browse All Jobs
          </Link>
        </div>
      </section>
    </Layout>
  );
};

export default Index;
