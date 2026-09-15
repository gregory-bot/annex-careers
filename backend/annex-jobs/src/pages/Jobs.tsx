import { useState, useMemo } from "react";
import { useJobs } from "../lib/jobStore";
import { Link, useSearchParams } from "react-router-dom";
import { Search, ChevronDown, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import Layout from "@/components/Layout";
import JobCard from "@/components/JobCard";

const jobTypes = ["All", "Full-time", "Remote", "Contract", "Part-time", "Internship"];
const locationFilters = ["All Locations", "Nairobi", "Mombasa", "Kisumu", "Eldoret", "Remote"];
const dateFilters = ["Any time", "Last 24h", "Last 3 days", "Last week", "Last month"];
const sortOptions = ["Most recent", "Salary (high to low)", "Relevance"];

const Jobs = () => {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const initialCat = searchParams.get("cat") || "";
  const initialType = searchParams.get("type") || "All";

  const [search, setSearch] = useState(initialQuery || initialCat);
  const [selectedType, setSelectedType] = useState(initialType);
  const [selectedLocation, setSelectedLocation] = useState("All Locations");
  const [selectedDate, setSelectedDate] = useState("Any time");
  const [sortBy, setSortBy] = useState("Most recent");
  const [showCount, setShowCount] = useState(8);

  const { jobs: allJobs, loading } = useJobs();

  const filtered = useMemo(() => {
    return allJobs.filter((job) => {
      // Text search (matches title, company, description, or tags)
      const q = search.toLowerCase();
      const matchesSearch =
        !search ||
        job.title.toLowerCase().includes(q) ||
        job.company.toLowerCase().includes(q) ||
        job.description?.toLowerCase().includes(q) ||
        job.category?.toLowerCase().includes(q);
      // Job type filter
      const matchesType =
        selectedType === "All" ||
        job.type?.toLowerCase() === selectedType.toLowerCase() ||
        (selectedType.toLowerCase() === "remote" && (job.remote || job.type?.toLowerCase().includes("remote") || job.location?.toLowerCase().includes("remote")));
      const matchesLocation =
        selectedLocation === "All Locations" ||
        job.location?.toLowerCase().includes(selectedLocation.toLowerCase());
      return matchesSearch && matchesType && matchesLocation;
    });
  }, [search, selectedType, selectedLocation, allJobs]);

  return (
    <Layout>
      <div className="pt-28 md:pt-36 lg:pt-20">
        {/* Search */}
        <div className="bg-muted border-b border-border">
          <div className="container py-6 sm:py-8 px-4">
            <h1 className="font-heading text-2xl sm:text-3xl font-bold mb-4 sm:mb-6">Browse Jobs</h1>
            <div className="flex bg-background rounded-xl border border-border overflow-hidden">
              <div className="flex items-center flex-1 px-3 sm:px-4 gap-2 sm:gap-3 min-w-0">
                <Search className="text-muted-foreground w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                <input
                  type="text"
                  placeholder="Search by title, company..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 py-3 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none text-sm min-w-0"
                />
              </div>
              <button className="px-4 sm:px-6 py-3 bg-primary text-primary-foreground font-medium text-sm shrink-0">
                Search
              </button>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="container py-4 sm:py-6 px-4">
          <div className="flex flex-wrap gap-2 mb-4 sm:mb-6">
            {jobTypes.map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs font-medium transition-colors ${
                  selectedType === type
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 sm:gap-3 mb-6 sm:mb-8">
            <div className="relative">
              <select title="Filter by category"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="appearance-none bg-muted border border-border rounded-lg px-3 sm:px-4 py-2 pr-7 sm:pr-8 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {locationFilters.map((loc) => (
                  <option key={loc}>{loc}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            </div>

            <div className="relative">
              <select title="Filter by company"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="appearance-none bg-muted border border-border rounded-lg px-3 sm:px-4 py-2 pr-7 sm:pr-8 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {dateFilters.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            </div>

            <div className="relative sm:ml-auto">
              <select title="Filter by location"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="appearance-none bg-muted border border-border rounded-lg px-3 sm:px-4 py-2 pr-7 sm:pr-8 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {sortOptions.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {loading ? (
            <div className="text-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading jobs...</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4 sm:mb-6">
                Showing {Math.min(showCount, filtered.length)} of {filtered.length} jobs
              </p>

              {/* Job grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                {filtered.slice(0, showCount).map((job, i) => (
                  <motion.div
                    key={job.id}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                  >
                    <JobCard job={job} />
                  </motion.div>
                ))}
              </div>

              {showCount < filtered.length && (
                <div className="text-center">
                  <button
                    onClick={() => setShowCount((c) => c + 6)}
                    className="px-8 py-3 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:opacity-90 transition-opacity"
                  >
                    Load More
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default Jobs;
