import { Fragment, useEffect, useState } from "react";
import { useJobs, type ListingKind } from "../lib/jobStore";
import { useSearchParams } from "react-router-dom";
import { Search, ChevronDown, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import Layout from "@/components/Layout";
import { useDocumentMeta } from "@/lib/seo";
import JobCard from "@/components/JobCard";
import AdBanner from "@/components/AdBanner";

const jobTypes = ["All", "Full-time", "Remote", "Contract", "Part-time", "Internship"];
const locationFilters = ["All Locations", "Nairobi", "Mombasa", "Kisumu", "Eldoret", "Remote"];
const dateFilters = ["Any time", "Last 24h", "Last 3 days", "Last week", "Last month"];
const sortOptions = ["Most recent", "Salary (high to low)", "Relevance"];

const PER_PAGE = 10;

/** Debounce a fast-changing value so we don't fire a network request per keystroke. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Listing page for jobs (/jobs) and contracts / consultancies (/contracts). */
const Jobs = ({ kind = "job" }: { kind?: ListingKind }) => {
  const isContract = kind === "contract";
  const noun = isContract ? "contracts" : "jobs";
  useDocumentMeta(isContract
    ? { title: "Contracts & Consultancies in Kenya", description: "Consultancy assignments, terms of reference and tenders from government, UN agencies, NGOs and companies in Kenya." }
    : { title: "Browse Jobs in Kenya", description: "Search hundreds of verified job openings across Kenya by title, company, location and type. Direct apply links." });
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const initialCat = searchParams.get("cat") || "";
  const initialType = searchParams.get("type") || "All";
  const initialPage = Number(searchParams.get("page")) || 1;

  const [searchInput, setSearchInput] = useState(initialQuery || initialCat);
  const [selectedType, setSelectedType] = useState(initialType);
  const [selectedLocation, setSelectedLocation] = useState("All Locations");
  const [selectedDate, setSelectedDate] = useState("Any time");
  const [sortBy, setSortBy] = useState("Most recent");
  const [page, setPage] = useState(initialPage);

  const debouncedSearch = useDebouncedValue(searchInput, 400);

  // Reset to page 1 whenever a filter actually changes the result set.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, selectedType, selectedLocation, sortBy]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const jobType = selectedType === "All" || selectedType === "Remote" ? undefined : selectedType;
  const remote = selectedType === "Remote" ? true : undefined;
  const location = selectedLocation === "All Locations" ? undefined : selectedLocation;
  const sortBy_ = sortBy === "Salary (high to low)" ? "salary_min" : "scraped_at";
  const sortOrder = "desc" as const;

  const { jobs, isLoading, data } = useJobs({
    page,
    perPage: PER_PAGE,
    search: debouncedSearch || undefined,
    jobType: isContract ? undefined : jobType,
    remote,
    location,
    kind,
    sortBy: sortBy_,
    sortOrder,
  });

  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  return (
    <Layout>
      <div className="pt-28 md:pt-36 lg:pt-20">
        {/* Search */}
        <div className="bg-muted border-b border-border">
          <div className="container py-6 sm:py-8 px-4">
            <h1 className="font-heading text-2xl sm:text-3xl font-bold mb-2">{isContract ? "Contracts & Consultancies" : "Browse Jobs"}</h1>
            {isContract && (
              <p className="text-sm text-muted-foreground mb-4 sm:mb-6">
                Short-term assignments, consultancies and tenders with their terms of reference, from government, UN agencies, NGOs and companies.
              </p>
            )}
            <div className="flex bg-background rounded-xl border border-border overflow-hidden">
              <div className="flex items-center flex-1 px-3 sm:px-4 gap-2 sm:gap-3 min-w-0">
                <Search className="text-muted-foreground w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                <input
                  type="text"
                  placeholder={isContract ? "Search by title, organization..." : "Search by title, company..."}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
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
          <div className={`flex flex-wrap gap-2 mb-4 sm:mb-6 ${isContract ? "hidden" : ""}`}>
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
              <select title="Filter by location"
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
              <select title="Filter by date posted"
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
              <select title="Sort by"
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

          {isLoading && jobs.length === 0 ? (
            <div className="text-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading {noun}...</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4 sm:mb-6">
                Showing {jobs.length} of {total} {noun}
              </p>

              {/* Job grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                {jobs.map((job, i) => (
                  <Fragment key={job.id}>
                    <motion.div
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                    >
                      <JobCard job={job} />
                    </motion.div>
                    {/* One sponsored banner after the first row of results. */}
                    {i === Math.min(2, jobs.length - 1) && (
                      <div className="col-span-full">
                        <AdBanner placement={isContract ? "contracts_list" : "jobs_list"} />
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>

              {jobs.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-12">
                  {isContract && !debouncedSearch && total === 0
                    ? "No contracts published yet. Consultancies and tenders appear here as they are collected or posted."
                    : `No ${noun} match your filters.`}
                </p>
              )}

              {pages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-4 py-2 bg-muted text-foreground rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted/80"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-muted-foreground px-2">
                    Page {page} of {pages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                    disabled={page >= pages}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
                  >
                    Next
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
