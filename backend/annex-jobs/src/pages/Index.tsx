import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import Layout from "@/components/Layout";
import Hero from "@/components/Hero";
import JobCard from "@/components/JobCard";
import { useJobs, useStats } from "@/lib/jobStore";

import { useMemo } from "react";

/** Returns true if this looks like a real geographic location */
function isValidLocation(loc: string): boolean {
  if (!loc || loc.length < 2) return false;
  // Exclude salary-like strings
  if (/KSh|USD|\$|KES/i.test(loc)) return false;
  // Exclude strings with comma-separated large numbers (salary patterns)
  if (/\d{2,},\d{3}/.test(loc)) return false;
  // Exclude "Confidential"
  if (/^confidential$/i.test(loc.trim())) return false;
  // Exclude concatenated garbage (contains job type keywords mashed in)
  if (/full.?time|part.?time|contract|internship|education/i.test(loc)) return false;
  // Exclude strings that are just numbers
  if (/^\d+[\s\-,\d]*$/.test(loc)) return false;
  // Must have letters
  if (!/[a-zA-Z]/.test(loc)) return false;
  return true;
}

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

const Index = () => {
  const { jobs: allJobs } = useJobs();
  const apiStats = useStats();
  const featuredJobs = allJobs.slice(0, 6);

  // Derive real stats from the jobs data
  const { statsCards, categories, locations } = useMemo(() => {
    const uniqueCompanies = new Set(allJobs.map((j) => j.company).filter(Boolean));

    const typeMap: Record<string, number> = {};
    let remoteCount = 0;
    allJobs.forEach((j) => {
      if (j.type) {
        const t = j.type.toLowerCase().trim();
        typeMap[t] = (typeMap[t] || 0) + 1;
      }
      if (j.remote || j.type?.toLowerCase().includes("remote") || j.location?.toLowerCase().includes("remote")) {
        remoteCount++;
      }
    });

    // Stats cards: simple numbers, no icons
    const totalJobs = apiStats?.active_jobs ?? allJobs.length;
    const fullTime = typeMap["full-time"] || typeMap["full time"] || 0;
    const contractJobs = typeMap["contract"] || 0;
    const partTime = typeMap["part-time"] || typeMap["part time"] || 0;

    const cards = [
      { label: "Total Jobs", value: totalJobs },
      { label: "Remote", value: remoteCount },
      { label: "Full-time", value: fullTime },
      { label: "Contract", value: contractJobs },
      { label: "Companies", value: uniqueCompanies.size },
      ...(partTime > 0 ? [{ label: "Part-time", value: partTime }] : []),
    ];

    // Categories: split comma-separated tags and count
    const catMap: Record<string, number> = {};
    allJobs.forEach((job) => {
      const cat = job.category;
      if (cat) {
        cat.split(",").forEach((c) => {
          const trimmed = c.trim().toLowerCase();
          if (trimmed) catMap[trimmed] = (catMap[trimmed] || 0) + 1;
        });
      }
    });
    const catList = Object.entries(catMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Locations: only valid, real geographic locations
    const locMap: Record<string, number> = {};
    allJobs.forEach((job) => {
      if (!job.location || !isValidLocation(job.location)) return;
      const loc = job.location.trim();
      locMap[loc] = (locMap[loc] || 0) + 1;
    });
    const locList = Object.values(
      Object.entries(locMap).reduce<Record<string, { name: string; jobCount: number }>>((acc, [name, count]) => {
        acc[name] = { name, jobCount: count };
        return acc;
      }, {})
    )
      .sort((a, b) => b.jobCount - a.jobCount)
      .slice(0, 6);

    return { statsCards: cards, categories: catList, locations: locList };
  }, [allJobs, apiStats]);

  return (
    <Layout>
      <Hero />

      {/* Stats Cards — simple numbers, no icons */}
      <section className="container py-12 sm:py-16 px-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {statsCards.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
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
          {featuredJobs.map((job, i) => (
            <motion.div
              key={job.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
            >
              <JobCard job={job} />
            </motion.div>
          ))}
        </div>
        {allJobs.length > 6 && (
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
            {categories.map((cat, i) => (
              <motion.div
                key={cat.name}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
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
          {locations.map((loc, i) => (
            <motion.div
              key={loc.name}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
            >
              <Link
                to={`/jobs?q=${encodeURIComponent(loc.name)}`}
                className="bg-card border border-border rounded-xl p-4 text-center hover-lift block"
              >
                <p className="font-heading font-semibold text-sm">{loc.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{loc.jobCount} jobs</p>
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
