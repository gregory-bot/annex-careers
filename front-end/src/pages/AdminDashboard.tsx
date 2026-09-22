import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  LogOut, LayoutDashboard, Mail, Activity, Search,
  Loader2, Send, RefreshCw, Users, Menu, X, PlusCircle,
  Eye, MousePointerClick, Trash2, Repeat, ChevronLeft, ChevronRight,
  Globe, Play, Pencil, Power, ExternalLink, CalendarClock,
  Building2, Copy, KeyRound, ShieldOff, ShieldCheck, Bell, FileText, Star, StarOff, Megaphone, Pause, PlayCircle,
} from "lucide-react";
import JobForm from "@/components/JobForm";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  useAdminJobs, useStats, useLocations,
  useScrapeLogsAdmin, useUsersAdmin, useAdminAnalytics, useSchedulerStatus,
  useJobSourcesAdmin, createJobSource, updateJobSource, deleteJobSource, runSourceScrape,
  useEmployerInvitesAdmin, createEmployerInvite, resendEmployerInvite, updateEmployerInvite, deleteEmployerInvite,
  useAlertsStatus, runAlertsNow, uploadListingFile, featureJob, unfeatureJob,
  useAdsAdmin, createAd, updateAd, deleteAd,
  sendBulkAlerts, triggerScrapeAll, createJob, deleteJob, repostJob,
  getAdminToken, clearAdminToken, fileUrl,
  type Job, type JobInput, type JobSource, type JobSourceInput, type SourceLastRun,
  type EmployerInvite, type EmployerInviteIssued, type ListingKind, type Ad, type AdInput, type AdPlacement,
} from "@/lib/jobStore";
import { isValidLocation } from "@/lib/locationUtils";

type Tab = "dashboard" | "addjob" | "sources" | "employers" | "ads" | "emails" | "logs";

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary";

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!getAdminToken()) navigate("/admin");
  }, [navigate]);

  const handleLogout = () => {
    clearAdminToken();
    navigate("/admin");
  };

  const navItems: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
    { id: "addjob", label: "Add Job", icon: <PlusCircle size={18} /> },
    { id: "sources", label: "Job Sources", icon: <Globe size={18} /> },
    { id: "employers", label: "Employers", icon: <Building2 size={18} /> },
    { id: "ads", label: "Ads", icon: <Megaphone size={18} /> },
    { id: "emails", label: "Email Trigger", icon: <Mail size={18} /> },
    { id: "logs", label: "Scrape Logs", icon: <Activity size={18} /> },
  ];

  return (
    <div className="min-h-screen bg-muted flex">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-screen w-60 bg-card border-r border-border flex flex-col transition-transform lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h1 className="font-heading text-lg font-bold"><span className="text-primary">Annex</span> Admin</h1>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden p-1 rounded hover:bg-muted"><X size={18} /></button>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => { setTab(item.id); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                tab === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <LogOut size={18} /> Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="lg:hidden sticky top-0 z-30 bg-background border-b border-border flex items-center h-14 px-4">
          <button onClick={() => setSidebarOpen(true)} className="p-2 -ml-2 rounded-lg hover:bg-muted">
            <Menu size={20} />
          </button>
          <h1 className="font-heading text-lg font-bold ml-3"><span className="text-primary">Annex</span> Admin</h1>
        </div>

        <div className="p-4 sm:p-6">
          {tab === "dashboard" && <DashboardTab />}
          {tab === "addjob" && <AddJobTab />}
          {tab === "sources" && <SourcesTab />}
          {tab === "employers" && <EmployersTab />}
          {tab === "ads" && <AdsTab />}
          {tab === "emails" && <EmailTriggerTab />}
          {tab === "logs" && <ScrapeLogsTab />}
        </div>
      </main>
    </div>
  );
};

// --- Shared helpers ---

function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value?: string | null) {
  if (!value) return "\u2014";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "\u2014";
  return date.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function PaginationBar({ page, pages, total, perPage, onPageChange, busy = false }: {
  page: number; pages: number; total: number; perPage: number;
  onPageChange: (page: number) => void; busy?: boolean;
}) {
  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-3 border-t border-border">
      <span className="text-xs text-muted-foreground flex items-center gap-2">
        {total === 0 ? "No results" : `Showing ${start}–${end} of ${total.toLocaleString()}`}
        {busy && <Loader2 size={12} className="animate-spin" />}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted/80"
        >
          <ChevronLeft size={14} /> Previous
        </button>
        <span className="text-xs text-muted-foreground px-1">Page {page} of {pages}</span>
        <button
          onClick={() => onPageChange(Math.min(pages, page + 1))}
          disabled={page >= pages}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// --- Dashboard ---

const JOBS_PER_PAGE = 10;
type StatusFilter = "all" | "active" | "inactive" | "featured";
const FEATURE_DURATIONS = [7, 14, 30];

function DashboardTab() {
  const queryClient = useQueryClient();
  const { stats } = useStats();
  const { locations } = useLocations();
  const { analytics, loading: analyticsLoading } = useAdminAnalytics();

  const [jobSearch, setJobSearch] = useState("");
  const debouncedSearch = useDebouncedValue(jobSearch.trim(), 300);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<"all" | ListingKind>("all");
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<Job | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  // A new search or filter always starts from the first page.
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, kindFilter]);

  const { jobs, total, pages, isLoading: jobsLoading, isFetching: jobsFetching } = useAdminJobs({
    page,
    perPage: JOBS_PER_PAGE,
    search: debouncedSearch || undefined,
    status: statusFilter === "featured" ? "all" : statusFilter,
    featured: statusFilter === "featured" || undefined,
    kind: kindFilter,
  });

  const locationCounts = useMemo(
    () => locations.filter((entry) => entry.name && isValidLocation(entry.name)),
    [locations],
  );

  const invalidateJobData = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
    queryClient.invalidateQueries({ queryKey: ["locations"] });
  };

  const handleRepost = async (job: Job) => {
    setActingId(job.id);
    try {
      const result = await repostJob(job.id);
      toast.success(result.message || "Job reposted");
      invalidateJobData();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to repost job"));
    } finally {
      setActingId(null);
    }
  };

  const handleFeature = async (job: Job, days: number) => {
    setActingId(job.id);
    try {
      const result = await featureJob(job.id, days);
      toast.success(`"${job.title}": ${result.message.toLowerCase()}`);
      invalidateJobData();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to feature listing"));
    } finally {
      setActingId(null);
    }
  };

  const handleUnfeature = async (job: Job) => {
    setActingId(job.id);
    try {
      await unfeatureJob(job.id);
      toast.success(`"${job.title}" is no longer featured`);
      invalidateJobData();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to unfeature listing"));
    } finally {
      setActingId(null);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const job = pendingDelete;
    setPendingDelete(null);
    setActingId(job.id);
    try {
      await deleteJob(job.id);
      toast.success(`Deleted "${job.title}"`);
      // Removing the last row on a page would leave it empty; step back one.
      if (jobs.length === 1 && page > 1) setPage(page - 1);
      invalidateJobData();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete job"));
    } finally {
      setActingId(null);
    }
  };

  return (
    <>
      <div className="mb-6">
        <h2 className="font-heading font-bold text-xl">Traffic overview</h2>
        <p className="text-sm text-muted-foreground">Views and outbound application activity across the platform.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <TrafficCard label="Total page views" value={analytics?.page_views.total} icon={<Eye size={17} />} accent />
        <TrafficCard label="Views this week" value={analytics?.page_views.this_week} icon={<Eye size={17} />} />
        <TrafficCard label="Views today" value={analytics?.page_views.today} icon={<Eye size={17} />} />
        <TrafficCard label="Application link clicks" value={analytics?.apply_clicks.total} icon={<MousePointerClick size={17} />} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        <AnalyticsList
          title="Clicks by job type"
          entries={analytics?.job_types ?? []}
          loading={analyticsLoading}
        />
        <AnalyticsList
          title="Clicks by source"
          entries={analytics?.sources ?? []}
          loading={analyticsLoading}
        />
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-heading font-semibold text-sm mb-3">Top jobs by applications</h3>
          {analyticsLoading ? <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto my-8" /> : analytics?.top_jobs.length ? (
            <div className="space-y-3">
              {analytics.top_jobs.slice(0, 5).map((entry, index) => (
                <div key={entry.id} className="flex items-start gap-3">
                  <span className="text-xs font-bold text-muted-foreground w-4">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{entry.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{entry.company || "Company not listed"}</p>
                  </div>
                  <span className="text-sm font-semibold">{entry.count}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground py-6 text-center">No application clicks yet.</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Jobs" value={stats?.total_jobs ?? "—"} />
        <StatCard label="Active Jobs" value={stats?.active_jobs ?? "—"} />
        <StatCard label="Sources" value={stats ? Object.keys(stats.sources).length : "—"} />
        <StatCard label="Locations" value={locationCounts.length} />
      </div>

      <div className="bg-card border border-border rounded-xl p-4 mb-6">
        <h3 className="font-heading font-semibold text-sm mb-3">Jobs by Location</h3>
        <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
          {locationCounts.slice(0, 30).map((entry) => (
            <span key={entry.name} className="bg-muted px-3 py-1.5 rounded-full text-xs font-medium">
              {entry.name}: {entry.count}
            </span>
          ))}
          {locationCounts.length > 30 && (
            <span className="bg-muted px-3 py-1.5 rounded-full text-xs font-medium text-muted-foreground">
              +{locationCounts.length - 30} more
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-heading font-bold text-lg">All Jobs ({jobsLoading ? "\u2026" : total.toLocaleString()})</h2>
          <p className="text-xs text-muted-foreground">
            Every job and contract in the database, {JOBS_PER_PAGE} per page. Search covers title, company, location, source and tags.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
          <div className="relative w-full sm:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search jobs..."
              value={jobSearch}
              onChange={(e) => setJobSearch(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as "all" | ListingKind)}
            className={`${inputClass} sm:w-36`}
            aria-label="Filter by kind"
          >
            <option value="all">Jobs & contracts</option>
            <option value="job">Jobs only</option>
            <option value="contract">Contracts only</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className={`${inputClass} sm:w-40`}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
            <option value="featured">Featured only</option>
          </select>
        </div>
      </div>

      {jobsLoading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">Title</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Company</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Location</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Source</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Status</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden xl:table-cell">Posted</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const busy = actingId === job.id;
                  return (
                    <tr key={job.id} className={`border-b border-border last:border-0 hover:bg-muted/50 ${busy ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3 font-medium">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="line-clamp-1">{job.title}</span>
                          {job.kind === "contract" && (
                            <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700"><FileText size={9} /> Contract</span>
                          )}
                          {job.is_featured && (
                            <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-primary text-primary-foreground" title={`Featured until ${formatDate(job.featured_until)}`}>
                              <Star size={9} fill="currentColor" /> Featured
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground sm:hidden">{job.company || "—"} · {job.location || "—"}</div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{job.company || "—"}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{job.location || "—"}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground capitalize">{job.source}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          job.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                        }`}>
                          {job.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden xl:table-cell text-muted-foreground text-xs whitespace-nowrap">
                        {formatDate(job.posted || job.scraped_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {job.is_featured ? (
                            <button
                              onClick={() => handleUnfeature(job)}
                              disabled={actingId !== null}
                              title={`Featured until ${formatDate(job.featured_until)}. Click to remove.`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                            >
                              <StarOff size={14} /><span className="hidden sm:inline">Unfeature</span>
                            </button>
                          ) : (
                            <select
                              value=""
                              onChange={(e) => { const days = Number(e.target.value); if (days) handleFeature(job, days); }}
                              disabled={actingId !== null}
                              title="Paid placement: pin to the top of the list"
                              className="text-xs font-medium text-amber-700 bg-transparent hover:bg-amber-50 rounded-lg px-2 py-1.5 border border-transparent focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                              aria-label={`Feature ${job.title}`}
                            >
                              <option value="">Feature{"\u2026"}</option>
                              {FEATURE_DURATIONS.map((d) => <option key={d} value={d}>{d} days</option>)}
                            </select>
                          )}
                          <button
                            onClick={() => handleRepost(job)}
                            disabled={actingId !== null}
                            title="Repost: reactivate and move to the top of the listing"
                            aria-label={`Repost ${job.title}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <Repeat size={14} />}
                            <span className="hidden sm:inline">Repost</span>
                          </button>
                          <button
                            onClick={() => setPendingDelete(job)}
                            disabled={actingId !== null}
                            title="Delete this job"
                            aria-label={`Delete ${job.title}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={14} />
                            <span className="hidden sm:inline">Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {jobs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      {debouncedSearch ? `No jobs match "${debouncedSearch}"` : "No jobs found"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationBar
            page={page}
            pages={pages}
            total={total}
            perPage={JOBS_PER_PAGE}
            onPageChange={setPage}
            busy={jobsFetching}
          />
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete this job?"
        confirmLabel="Delete"
        onConfirm={handleDelete}
        description={pendingDelete ? (
          <>
            &ldquo;{pendingDelete.title}&rdquo;{pendingDelete.company ? ` at ${pendingDelete.company}` : ""} will be
            permanently removed from the site. This cannot be undone.
            {pendingDelete.source !== "manual" && " If the source still lists it, the next scrape may add it back."}
          </>
        ) : null}
      />
    </>
  );
}

function TrafficCard({ label, value, icon, accent = false }: { label: string; value?: number; icon: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`border rounded-xl p-4 ${accent ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"}`}>
      <div className={`flex items-center gap-2 text-xs uppercase tracking-wide ${accent ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
        {icon} {label}
      </div>
      <p className="font-heading text-2xl font-bold mt-2">{value === undefined ? "-" : value.toLocaleString()}</p>
    </div>
  );
}

function AnalyticsList({ title, entries, loading }: { title: string; entries: Array<{ name: string; count: number }>; loading: boolean }) {
  const maximum = Math.max(...entries.map((entry) => entry.count), 1);
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-heading font-semibold text-sm mb-4">{title}</h3>
      {loading ? <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto my-8" /> : entries.length ? (
        <div className="space-y-3">
          {entries.slice(0, 6).map((entry) => (
            <div key={entry.name}>
              <div className="flex justify-between gap-3 text-xs mb-1">
                <span className="truncate">{entry.name}</span>
                <span className="font-semibold">{entry.count}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${(entry.count / maximum) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-muted-foreground py-6 text-center">No application clicks yet.</p>}
    </div>
  );
}

// --- Add job ---

function AddJobTab() {
  const queryClient = useQueryClient();

  const handleSubmit = async (input: JobInput) => {
    const result = await createJob(input);
    toast.success(`${input.kind === "contract" ? "Contract" : "Job"} created (ID: ${result.job_id})`);
    queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
  };

  return (
    <>
      <div className="mb-6">
        <h2 className="font-heading font-bold text-lg">Add a Job or Contract Manually</h2>
        <p className="text-sm text-muted-foreground">Post an opening or a consultancy / tender you found elsewhere so users can discover and apply</p>
      </div>
      <JobForm allowKindSwitch onSubmit={handleSubmit} uploader={(file) => uploadListingFile(file, "admin")} />
    </>
  );
}

// --- Employers (invite companies to post their own jobs) ---

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy; select and copy it manually");
  }
}

function IssuedCodePanel({ issued, onDismiss }: { issued: EmployerInviteIssued; onDismiss: () => void }) {
  return (
    <div className={`mb-6 rounded-xl border p-4 sm:p-5 ${issued.emailed ? "border-primary/40 bg-primary/5" : "border-amber-300 bg-amber-50"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading font-semibold flex items-center gap-2"><KeyRound size={16} className="text-primary" /> Access code for {issued.company_name}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {issued.emailed
              ? `Emailed to ${issued.email}. Shown here once in case the email does not arrive.`
              : `Not emailed. Send this code and the link to ${issued.email} yourself; it is shown only once.`}
          </p>
          {!issued.emailed && issued.email_error && (
            <p className="text-xs text-amber-800 mt-2 break-words">
              <span className="font-semibold">Email failed:</span> {issued.email_error}
            </p>
          )}
        </div>
        <button onClick={onDismiss} className="p-1.5 rounded-lg hover:bg-muted" aria-label="Dismiss"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        <div className="bg-card border border-border rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Access code</p>
          <div className="flex items-center justify-between gap-2 mt-1">
            <code className="font-mono text-lg font-bold tracking-widest">{issued.access_code}</code>
            <button onClick={() => copyText(issued.access_code, "Access code")} className="p-1.5 rounded-lg hover:bg-muted" title="Copy code"><Copy size={15} /></button>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Employer page</p>
          <div className="flex items-center justify-between gap-2 mt-1 min-w-0">
            <a href={issued.portal_url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline truncate">{issued.portal_url}</a>
            <button onClick={() => copyText(issued.portal_url, "Link")} className="p-1.5 rounded-lg hover:bg-muted shrink-0" title="Copy link"><Copy size={15} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

const EMPTY_INVITE_FORM = { company_name: "", contact_name: "", email: "", expires_in_days: "", note: "", send_email: true };

function InviteForm({ emailConfigured, onIssued, onCancel }: {
  emailConfigured: boolean;
  onIssued: (issued: EmployerInviteIssued) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_INVITE_FORM, send_email: emailConfigured });
  const [saving, setSaving] = useState(false);
  const update = (field: keyof typeof EMPTY_INVITE_FORM, value: string | boolean) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company_name.trim()) return toast.error("Company name is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return toast.error("Enter a valid contact email");
    const days = form.expires_in_days.trim() ? Number(form.expires_in_days) : null;
    if (days !== null && (!Number.isInteger(days) || days < 1)) return toast.error("Expiry must be a whole number of days");
    setSaving(true);
    try {
      const issued = await createEmployerInvite({
        company_name: form.company_name.trim(),
        email: form.email.trim(),
        contact_name: form.contact_name.trim() || undefined,
        note: form.note.trim() || undefined,
        expires_in_days: days,
        send_email: form.send_email,
      });
      if (issued.emailed) toast.success(`Invitation emailed to ${issued.email}`);
      else if (issued.email_error) toast.warning(`Access created, but the email failed. Share the code shown below.`);
      else toast.success(`Access created for ${issued.company_name}`);
      onIssued(issued);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to invite company"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-primary/40 rounded-xl p-4 sm:p-6 mb-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-heading font-semibold">Invite a company</h3>
          <p className="text-xs text-muted-foreground">
            They receive the employer page link and a unique access code. The code unlocks only the job form, and every job they post is filed under their company name.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="p-1.5 rounded-lg hover:bg-muted" aria-label="Close form"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Company name *</label>
            <input type="text" value={form.company_name} onChange={(e) => update("company_name", e.target.value)} placeholder="e.g. Safaricom PLC" className={inputClass} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Contact name</label>
              <input type="text" value={form.contact_name} onChange={(e) => update("contact_name", e.target.value)} placeholder="e.g. Amina Otieno" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Contact email *</label>
              <input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="hr@company.co.ke" className={inputClass} />
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium mb-1">Access expires after (days)</label>
              <input type="number" min={1} value={form.expires_in_days} onChange={(e) => update("expires_in_days", e.target.value)} placeholder="Leave blank for no expiry" className={inputClass} />
            </div>
            <label className={`flex items-center gap-2 text-sm font-medium pb-2 ${emailConfigured ? "" : "opacity-60"}`}>
              <input type="checkbox" checked={form.send_email} disabled={!emailConfigured} onChange={(e) => update("send_email", e.target.checked)} className="rounded" />
              Email the invitation now
            </label>
          </div>
          {!emailConfigured && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No email provider is configured on the server, so the code will be shown here for you to send manually.
            </p>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Internal note</label>
            <input type="text" value={form.note} onChange={(e) => update("note", e.target.value)} placeholder="e.g. Met at the Nairobi HR summit" className={inputClass} />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-border">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80">Cancel</button>
        <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {saving ? "Creating..." : form.send_email ? "Create & email invite" : "Create access"}
        </button>
      </div>
    </form>
  );
}

const EMPLOYERS_PER_PAGE = 10;

function EmployersTab() {
  const queryClient = useQueryClient();
  const { employers, portalUrl, emailConfigured, loading, refresh } = useEmployerInvitesAdmin();
  const [showForm, setShowForm] = useState(false);
  const [issued, setIssued] = useState<EmployerInviteIssued | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EmployerInvite | null>(null);
  const [pendingResend, setPendingResend] = useState<EmployerInvite | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "employers"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
  };

  const handleResend = async () => {
    if (!pendingResend) return;
    const invite = pendingResend;
    setPendingResend(null);
    setActingId(invite.id);
    try {
      const result = await resendEmployerInvite(invite.id, emailConfigured);
      if (result.emailed) toast.success(`New code emailed to ${invite.email}`);
      else if (result.email_error) toast.warning(`New code issued, but the email failed. Share the code shown below.`);
      else toast.success(`New code issued for ${invite.company_name}`);
      setIssued(result);
      invalidate();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to issue a new code"));
    } finally {
      setActingId(null);
    }
  };

  const handleToggleStatus = async (invite: EmployerInvite) => {
    setActingId(invite.id);
    try {
      const next = invite.status === "active" ? "revoked" : "active";
      await updateEmployerInvite(invite.id, { status: next });
      toast.success(next === "revoked" ? `${invite.company_name} can no longer sign in` : `${invite.company_name} reactivated`);
      invalidate();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update"));
    } finally {
      setActingId(null);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const invite = pendingDelete;
    setPendingDelete(null);
    setActingId(invite.id);
    try {
      await deleteEmployerInvite(invite.id);
      toast.success(`Removed ${invite.company_name}`);
      invalidate();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete"));
    } finally {
      setActingId(null);
    }
  };

  const pages = Math.max(1, Math.ceil(employers.length / EMPLOYERS_PER_PAGE));
  const visible = employers.slice((page - 1) * EMPLOYERS_PER_PAGE, page * EMPLOYERS_PER_PAGE);

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-heading font-bold text-lg">Employers</h2>
          <p className="text-sm text-muted-foreground">Invite companies to post jobs themselves. Each gets the employer page link and its own access code.</p>
          {portalUrl && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
              Employer page: <a href={portalUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{portalUrl}</a>
              <button onClick={() => copyText(portalUrl, "Link")} className="p-1 rounded hover:bg-muted" title="Copy link"><Copy size={12} /></button>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refresh()} className="p-2 rounded-lg border border-input hover:bg-muted" title="Refresh"><RefreshCw size={16} /></button>
          <button onClick={() => setShowForm(true)} disabled={showForm} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
            <PlusCircle size={16} /> Invite company
          </button>
        </div>
      </div>

      {showForm && (
        <InviteForm
          emailConfigured={emailConfigured}
          onIssued={(result) => { setShowForm(false); setIssued(result); setPage(1); invalidate(); }}
          onCancel={() => setShowForm(false)}
        />
      )}
      {issued && <IssuedCodePanel issued={issued} onDismiss={() => setIssued(null)} />}

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
      ) : employers.length === 0 ? (
        <div className="bg-card border border-dashed border-border rounded-xl text-center py-10 text-muted-foreground">
          <Building2 size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No companies invited yet.</p>
          <p className="text-xs mt-1">Invite one and it can start posting its vacancies right away.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">Company</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Contact</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Jobs</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Last sign-in</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden xl:table-cell">Invited</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((inv) => {
                  const busy = actingId === inv.id;
                  const active = inv.status === "active" && !inv.expired;
                  return (
                    <tr key={inv.id} className={`border-b border-border last:border-0 hover:bg-muted/50 ${busy ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{inv.company_name}</div>
                        {inv.note && <div className="text-xs text-muted-foreground truncate max-w-[220px]" title={inv.note}>{inv.note}</div>}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-sm">{inv.contact_name || "\u2014"}</div>
                        <div className="text-xs text-muted-foreground">{inv.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          inv.status === "revoked" ? "bg-red-100 text-red-700" : inv.expired ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"
                        }`}>
                          {inv.status === "revoked" ? "Revoked" : inv.expired ? "Expired" : "Active"}
                        </span>
                        {inv.expires_at && inv.status === "active" && !inv.expired && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">until {formatDate(inv.expires_at)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">{inv.jobs_posted}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">{inv.last_login_at ? formatDateTime(inv.last_login_at) : "Never"}</td>
                      <td className="px-4 py-3 hidden xl:table-cell text-xs text-muted-foreground">
                        {formatDate(inv.created_at)}
                        <div>{inv.email_sent_at ? "emailed" : "not emailed"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          <button onClick={() => setPendingResend(inv)} disabled={busy || inv.status !== "active"} title="Issue a new access code and email it" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed">
                            <KeyRound size={14} /><span className="hidden sm:inline">New code</span>
                          </button>
                          <button onClick={() => handleToggleStatus(inv)} disabled={busy} title={inv.status === "active" ? "Revoke access" : "Reactivate access"} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-muted disabled:opacity-50">
                            {inv.status === "active" ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
                            <span className="hidden sm:inline">{inv.status === "active" ? "Revoke" : "Reactivate"}</span>
                          </button>
                          <button onClick={() => setPendingDelete(inv)} disabled={busy} title="Delete invite" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                            <Trash2 size={14} /><span className="hidden sm:inline">Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PaginationBar page={page} pages={pages} total={employers.length} perPage={EMPLOYERS_PER_PAGE} onPageChange={setPage} />
        </div>
      )}

      <ConfirmDialog
        open={pendingResend !== null}
        onOpenChange={(open) => { if (!open) setPendingResend(null); }}
        title="Issue a new access code?"
        confirmLabel="Issue new code"
        onConfirm={handleResend}
        description={pendingResend ? `${pendingResend.company_name}'s current code stops working immediately. The new one ${emailConfigured ? `is emailed to ${pendingResend.email} and ` : ""}will be shown to you once.` : null}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete this invite?"
        confirmLabel="Delete"
        onConfirm={handleDelete}
        description={pendingDelete ? `${pendingDelete.company_name} will no longer be able to sign in. Jobs they already posted stay live.` : null}
      />
    </>
  );
}

// --- Ads (banners sold directly to advertisers) ---

const EMPTY_AD_FORM = {
  name: "", advertiser: "", placement: "jobs_list" as AdPlacement, headline: "", link_url: "",
  image_url: "", image_attachment_id: null as number | null, image_preview: "",
  starts_at: "", ends_at: "", weight: "1", is_active: true, notes: "",
};
type AdFormState = typeof EMPTY_AD_FORM;

function adToForm(ad: Ad): AdFormState {
  return {
    name: ad.name, advertiser: ad.advertiser ?? "", placement: ad.placement, headline: ad.headline ?? "",
    link_url: ad.link_url, image_url: ad.image_url ?? "", image_attachment_id: ad.image_attachment_id,
    image_preview: ad.image ?? "", starts_at: ad.starts_at ? ad.starts_at.slice(0, 10) : "",
    ends_at: ad.ends_at ? ad.ends_at.slice(0, 10) : "", weight: String(ad.weight), is_active: ad.is_active, notes: ad.notes ?? "",
  };
}

function adToInput(ad: Ad, overrides: Partial<AdInput> = {}): AdInput {
  return {
    name: ad.name, advertiser: ad.advertiser ?? undefined, placement: ad.placement, headline: ad.headline ?? undefined,
    link_url: ad.link_url, image_url: ad.image_url ?? undefined, image_attachment_id: ad.image_attachment_id,
    starts_at: ad.starts_at ?? undefined, ends_at: ad.ends_at ?? undefined, weight: ad.weight, notes: ad.notes ?? undefined,
    is_active: ad.is_active, ...overrides,
  };
}

function AdForm({ initial, placements, onSaved, onCancel }: {
  initial: Ad | null;
  placements: Record<AdPlacement, string>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AdFormState>(initial ? adToForm(initial) : EMPTY_AD_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const update = (field: keyof AdFormState, value: string | boolean | number | null) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleCreative = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return toast.error("The banner must be an image (JPG, PNG or WEBP)");
    setUploading(true);
    try {
      const result = await uploadListingFile(file, "admin", { extract: false });
      setForm((prev) => ({ ...prev, image_attachment_id: result.id, image_preview: result.url, image_url: "" }));
      toast.success(`Uploaded ${file.name}`);
    } catch (err) {
      toast.error(errorMessage(err, "Upload failed"));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Give the ad a name");
    if (!/^https?:\/\//i.test(form.link_url.trim())) return toast.error("The link must start with http:// or https://");
    if (!form.image_attachment_id && !form.image_url.trim()) return toast.error("Upload a banner image or paste an image URL");
    setSaving(true);
    try {
      const payload: AdInput = {
        name: form.name.trim(), advertiser: form.advertiser.trim() || undefined, placement: form.placement,
        headline: form.headline.trim() || undefined, link_url: form.link_url.trim(),
        image_url: form.image_url.trim() || undefined, image_attachment_id: form.image_attachment_id,
        starts_at: form.starts_at || undefined, ends_at: form.ends_at || undefined,
        weight: Math.min(10, Math.max(1, Number(form.weight) || 1)), is_active: form.is_active, notes: form.notes.trim() || undefined,
      };
      const saved = initial ? await updateAd(initial.id, payload) : await createAd(payload);
      toast.success(initial ? `Updated ${saved.name}` : `${saved.name} is ${saved.status}`);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save ad"));
    } finally {
      setSaving(false);
    }
  };

  const preview = form.image_preview || form.image_url;

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-primary/40 rounded-xl p-4 sm:p-6 mb-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-heading font-semibold">{initial ? `Edit ${initial.name}` : "New banner ad"}</h3>
          <p className="text-xs text-muted-foreground">Sold directly to the advertiser. It shows in one placement while active and inside its dates; impressions and clicks are counted for you.</p>
        </div>
        <button type="button" onClick={onCancel} className="p-1.5 rounded-lg hover:bg-muted" aria-label="Close form"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Internal name *</label>
              <input type="text" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Safaricom Sept campaign" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Advertiser</label>
              <input type="text" value={form.advertiser} onChange={(e) => update("advertiser", e.target.value)} placeholder="e.g. Safaricom PLC" className={inputClass} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Placement *</label>
            <select value={form.placement} onChange={(e) => update("placement", e.target.value as AdPlacement)} className={inputClass}>
              <option value="home">Homepage banner</option>
              <option value="jobs_list">Jobs list</option>
              <option value="contracts_list">Contracts list</option>
              <option value="job_sidebar">Job / contract page sidebar</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">{placements[form.placement] ?? ""}</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Click-through link *</label>
            <input type="url" value={form.link_url} onChange={(e) => update("link_url", e.target.value)} placeholder="https://advertiser.com/landing-page" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Headline / alt text</label>
            <input type="text" value={form.headline} onChange={(e) => update("headline", e.target.value)} placeholder="Shown on hover and to screen readers" className={inputClass} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Starts</label>
              <input type="date" value={form.starts_at} onChange={(e) => update("starts_at", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ends</label>
              <input type="date" value={form.ends_at} onChange={(e) => update("ends_at", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Weight (1-10)</label>
              <input type="number" min={1} max={10} value={form.weight} onChange={(e) => update("weight", e.target.value)} className={inputClass} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={form.is_active} onChange={(e) => update("is_active", e.target.checked)} className="rounded" />
            Active (uncheck to pause without deleting)
          </label>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Banner image *</label>
            <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3">
              {preview ? (
                <img src={fileUrl(preview)} alt="Banner preview" className="w-full max-h-48 object-contain rounded-md bg-card border border-border mb-3" />
              ) : (
                <p className="text-xs text-muted-foreground mb-3">No image yet. Upload the advertiser's creative or paste a hosted image URL below.</p>
              )}
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-input bg-card text-sm font-medium hover:bg-muted cursor-pointer">
                {uploading ? <Loader2 size={15} className="animate-spin" /> : <PlusCircle size={15} />}
                {uploading ? "Uploading..." : form.image_attachment_id ? "Replace image" : "Upload image"}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleCreative(e.target.files)} />
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">or image URL</label>
            <input type="url" value={form.image_url} onChange={(e) => setForm((prev) => ({ ...prev, image_url: e.target.value, image_attachment_id: e.target.value ? null : prev.image_attachment_id, image_preview: e.target.value ? "" : prev.image_preview }))} placeholder="https://cdn.advertiser.com/banner.jpg" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes (price, contact, invoice)</label>
            <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={3} placeholder="e.g. KES 15,000 for 30 days, paid via M-Pesa 22 Sep" className={`${inputClass} resize-y`} />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-border">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80">Cancel</button>
        <button type="submit" disabled={saving || uploading} className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Megaphone size={16} />}
          {saving ? "Saving..." : initial ? "Save changes" : "Create ad"}
        </button>
      </div>
    </form>
  );
}

function AdStatusBadge({ status }: { status: Ad["status"] }) {
  const cls = status === "active" ? "bg-green-100 text-green-700" : status === "scheduled" ? "bg-blue-100 text-blue-700"
    : status === "expired" ? "bg-gray-100 text-gray-600" : "bg-amber-100 text-amber-700";
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${cls}`}>{status}</span>;
}

function AdsTab() {
  const queryClient = useQueryClient();
  const { ads, placements, loading, refresh } = useAdsAdmin();
  const [editing, setEditing] = useState<Ad | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Ad | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "ads"] });
    queryClient.invalidateQueries({ queryKey: ["ads"] });
  };

  const togglePause = async (ad: Ad) => {
    setActingId(ad.id);
    try {
      await updateAd(ad.id, adToInput(ad, { is_active: !ad.is_active }));
      toast.success(ad.is_active ? `${ad.name} paused` : `${ad.name} resumed`);
      invalidate();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update ad"));
    } finally {
      setActingId(null);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const ad = pendingDelete;
    setPendingDelete(null);
    setActingId(ad.id);
    try {
      await deleteAd(ad.id);
      toast.success(`Deleted ${ad.name}`);
      invalidate();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete ad"));
    } finally {
      setActingId(null);
    }
  };

  const totals = ads.reduce(
    (acc, ad) => ({ impressions: acc.impressions + ad.impressions, clicks: acc.clicks + ad.clicks, live: acc.live + (ad.status === "active" ? 1 : 0) }),
    { impressions: 0, clicks: 0, live: 0 },
  );

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-heading font-bold text-lg">Ads</h2>
          <p className="text-sm text-muted-foreground">Banner placements you sell directly to advertisers. Payment is handled outside the site; switch the ad on once it is paid. Featured listings are managed from the Dashboard table.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refresh()} className="p-2 rounded-lg border border-input hover:bg-muted" title="Refresh"><RefreshCw size={16} /></button>
          <button onClick={() => setEditing("new")} disabled={editing === "new"} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
            <PlusCircle size={16} /> New ad
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Live ads" value={totals.live} />
        <StatCard label="Impressions" value={totals.impressions} />
        <StatCard label="Clicks" value={totals.clicks} />
      </div>

      {editing !== null && (
        <AdForm key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? null : editing} placements={placements} onSaved={() => { setEditing(null); invalidate(); }} onCancel={() => setEditing(null)} />
      )}

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
      ) : ads.length === 0 ? (
        <div className="bg-card border border-dashed border-border rounded-xl text-center py-10 text-muted-foreground">
          <Megaphone size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No ads yet.</p>
          <p className="text-xs mt-1">Create one with the advertiser's banner, a link and a placement.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">Ad</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Placement</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Schedule</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right hidden sm:table-cell">Impressions</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right">Clicks</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right hidden sm:table-cell">CTR</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ads.map((ad) => {
                  const busy = actingId === ad.id;
                  return (
                    <tr key={ad.id} className={`border-b border-border last:border-0 hover:bg-muted/50 ${busy ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {ad.image ? <img src={fileUrl(ad.image)} alt="" className="w-16 h-10 object-cover rounded border border-border shrink-0" /> : <div className="w-16 h-10 rounded bg-muted shrink-0" />}
                          <div className="min-w-0">
                            <div className="font-medium truncate">{ad.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{ad.advertiser || "\u2014"} {"\u00b7"} <a href={ad.link_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">link</a></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">{ad.placement.replace("_", " ")}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {ad.starts_at ? formatDate(ad.starts_at) : "now"} {"\u2192"} {ad.ends_at ? formatDate(ad.ends_at) : "until paused"}
                      </td>
                      <td className="px-4 py-3"><AdStatusBadge status={ad.status} /></td>
                      <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">{ad.impressions.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{ad.clicks.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">{ad.ctr}%</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          <button onClick={() => setEditing(ad)} disabled={busy} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-muted disabled:opacity-50"><Pencil size={14} /><span className="hidden sm:inline">Edit</span></button>
                          <button onClick={() => togglePause(ad)} disabled={busy} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-muted disabled:opacity-50">
                            {ad.is_active ? <Pause size={14} /> : <PlayCircle size={14} />}<span className="hidden sm:inline">{ad.is_active ? "Pause" : "Resume"}</span>
                          </button>
                          <button onClick={() => setPendingDelete(ad)} disabled={busy} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={14} /><span className="hidden sm:inline">Delete</span></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete this ad?"
        confirmLabel="Delete"
        onConfirm={handleDelete}
        description={pendingDelete ? `${pendingDelete.name} and its impression and click counts will be removed. Use Pause if you only want to stop showing it.` : null}
      />
    </>
  );
}

// --- Email trigger ---

const USERS_PER_PAGE = 10;

function hourUtcToLocal(hourUtc: number) {
  const d = new Date();
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** The daily automatic alert pipeline: what it does, when it runs next, what happened last time. */
function AutomaticAlertsPanel() {
  const { status, loading, refresh } = useAlertsStatus();
  const [starting, setStarting] = useState(false);

  const handleRunNow = async () => {
    setStarting(true);
    try {
      const result = await runAlertsNow();
      toast.success(`${result.message}. Results appear here when it finishes.`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to start job alerts"));
    } finally {
      setStarting(false);
    }
  };

  const summary = status?.last_summary;
  const running = Boolean(status?.running);

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading font-semibold flex items-center gap-2"><Bell size={16} className="text-primary" /> Automatic job alerts</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Every subscriber and CV uploader is matched to jobs and contracts they have not received yet and emailed once a day. Nothing is sent twice.
          </p>
          {loading || !status ? (
            <p className="text-xs text-muted-foreground mt-3 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Loading schedule...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 text-sm">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Schedule</p>
                <p className="font-medium flex items-center gap-1.5"><CalendarClock size={14} className="text-muted-foreground" /> Daily at {hourUtcToLocal(status.hour_utc)}</p>
                <p className="text-xs text-muted-foreground">Next run: {status.next_run ? formatDateTime(status.next_run) : "scheduler not running"}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Last run</p>
                {running ? (
                  <p className="font-medium flex items-center gap-1.5"><Loader2 size={14} className="animate-spin text-primary" /> Sending now...</p>
                ) : status.last_run_at ? (
                  <>
                    <p className="font-medium">{formatDateTime(status.last_run_at)}</p>
                    {status.last_error ? (
                      <p className="text-xs text-red-600 break-words">Failed: {status.last_error}</p>
                    ) : summary?.skipped ? (
                      <p className="text-xs text-amber-700">Skipped: {summary.reason}</p>
                    ) : summary ? (
                      <p className="text-xs text-muted-foreground">
                        Emailed {summary.emailed} of {summary.users} users ({summary.jobs_sent} listings){summary.failed ? `, ${summary.failed} failed` : ""}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Not run since the server started</p>
                )}
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Email</p>
                <p className={`font-medium ${status.email_configured ? "text-green-700" : "text-amber-700"}`}>
                  {status.email_configured ? "Provider configured" : "No provider configured"}
                </p>
                {!status.email_configured && <p className="text-xs text-muted-foreground">Set SMTP or Brevo in .env; runs are skipped until then.</p>}
              </div>
            </div>
          )}
        </div>
        <button
          onClick={handleRunNow}
          disabled={starting || running || !status?.email_configured}
          className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          title="Run the automatic pipeline now instead of waiting for the schedule"
        >
          {starting || running ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />}
          {running ? "Sending..." : "Send today's alerts now"}
        </button>
      </div>
    </div>
  );
}

function EmailTriggerTab() {
  const [filter, setFilter] = useState<"all" | "subscribe" | "cv_upload">("all");
  const [page, setPage] = useState(1);
  const { users: filtered, total, pages, loading, refresh } = useUsersAdmin(
    page,
    USERS_PER_PAGE,
    filter === "all" ? undefined : filter,
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);

  const changeFilter = (f: "all" | "subscribe" | "cv_upload") => {
    setFilter(f);
    setPage(1);
  };

  const toggleAll = () => {
    if (filtered.every((u) => selected.has(u.id)) && filtered.length > 0) {
      const next = new Set(selected);
      filtered.forEach((u) => next.delete(u.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filtered.forEach((u) => next.add(u.id));
      setSelected(next);
    }
  };

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handleSend = async () => {
    if (selected.size === 0) return toast.error("Select at least one user");
    setSending(true);
    try {
      const result = await sendBulkAlerts(Array.from(selected));
      toast.success(`Sending emails to ${result.sent} users`);
      setSelected(new Set());
      setTimeout(refresh, 2000);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to send emails"));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-heading font-bold text-lg">Email Trigger</h2>
          <p className="text-sm text-muted-foreground">Alerts go out automatically every morning; use the list below to email specific people right away.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refresh()} className="p-2 rounded-lg border border-input hover:bg-muted" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={handleSend}
            disabled={sending || selected.size === 0}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Send Alerts ({selected.size})
          </button>
        </div>
      </div>

      <AutomaticAlertsPanel />

      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex gap-2">
          {(["all", "subscribe", "cv_upload"] as const).map((f) => (
            <button
              key={f}
              onClick={() => changeFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "all" ? "All" : f === "subscribe" ? "Subscribers" : "CV Uploads"}
              {filter === f ? ` (${total})` : ""}
            </button>
          ))}
        </div>
        {selected.size > 0 && (
          <span className="text-xs text-muted-foreground">{selected.size} selected across pages</span>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No users yet</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 w-10">
                    <input type="checkbox" checked={filtered.length > 0 && filtered.every((u) => selected.has(u.id))} onChange={toggleAll} className="rounded" />
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Name</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Source</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Interests</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Last Emailed</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(user.id)} onChange={() => toggle(user.id)} className="rounded" />
                    </td>
                    <td className="px-4 py-3 font-medium">{user.email}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{user.name || "—"}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.source === "subscribe" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
                      }`}>
                        {user.source === "subscribe" ? "Subscriber" : "CV Upload"}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">{user.job_interests || "—"}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                      {user.last_emailed_at ? new Date(user.last_emailed_at).toLocaleDateString() : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar page={page} pages={pages} total={total} perPage={USERS_PER_PAGE} onPageChange={setPage} busy={loading} />
        </div>
      )}
    </>
  );
}

// --- Scrape logs ---

const LOGS_PER_PAGE = 10;

function formatDuration(started?: string | null, finished?: string | null) {
  if (!started || !finished) return "\u2014";
  const seconds = Math.round((new Date(finished).getTime() - new Date(started).getTime()) / 1000);
  if (!isFinite(seconds) || seconds < 0) return "\u2014";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
      status === "success" ? "bg-green-100 text-green-700" :
      status === "failed" ? "bg-red-100 text-red-700" :
      "bg-yellow-100 text-yellow-700"
    }`}>
      {status === "running" && <Loader2 size={10} className="animate-spin" />}
      {status}
    </span>
  );
}

function NextRunNote({ nextRun }: { nextRun: string | null }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
      <CalendarClock size={13} />
      Every enabled source is scraped automatically once a day.
      {nextRun ? <> Next run: <span className="font-medium text-foreground">{formatDateTime(nextRun)}</span>.</> : null}
    </p>
  );
}

function ScrapeLogsTab() {
  const [page, setPage] = useState(1);
  const { logs, total, pages, inProgress, runningSources, loading, fetching, refresh } =
    useScrapeLogsAdmin(page, LOGS_PER_PAGE);
  const { nextRun } = useSchedulerStatus();
  const [starting, setStarting] = useState(false);

  const handleRunScrape = async () => {
    setStarting(true);
    try {
      const result = await triggerScrapeAll();
      toast.success(`Scrape started across ${result.sources} sources. Results appear below as each one finishes.`);
      setPage(1);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to start scrape"));
    } finally {
      setStarting(false);
    }
  };

  const busy = starting || inProgress;

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-heading font-bold text-lg">Scrape Logs</h2>
          <p className="text-sm text-muted-foreground">View scraping history and trigger manual scrapes</p>
          <NextRunNote nextRun={nextRun} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refresh()} className="p-2 rounded-lg border border-input hover:bg-muted" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={handleRunScrape}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Activity size={16} />}
            {starting ? "Starting..." : inProgress ? "Scraping..." : "Run Scrape Now"}
          </button>
        </div>
      </div>

      {inProgress && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <Loader2 size={16} className="animate-spin text-primary shrink-0" />
          <span>
            A scrape is running{runningSources.length > 0 ? ` (${runningSources.join(", ")})` : ""}.
            This list refreshes automatically every few seconds until it finishes.
          </span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
      ) : total === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Activity size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No scrape logs yet</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">Source</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Found</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">New</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Updated</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Started</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Duration</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Error</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3 font-medium capitalize">{log.source.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3"><StatusBadge status={log.status} /></td>
                    <td className="px-4 py-3">{log.jobs_found}</td>
                    <td className="px-4 py-3 hidden sm:table-cell">{log.jobs_new}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{log.jobs_updated}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs whitespace-nowrap">
                      {log.started_at ? new Date(log.started_at).toLocaleString() : "\u2014"}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">
                      {formatDuration(log.started_at, log.finished_at)}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-red-500 max-w-[200px] truncate" title={log.error_message || undefined}>
                      {log.error_message || "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar page={page} pages={pages} total={total} perPage={LOGS_PER_PAGE} onPageChange={setPage} busy={fetching} />
        </div>
      )}
    </>
  );
}

// --- Job sources ---

const EMPTY_SOURCE_FORM = {
  name: "",
  urls: "",
  default_company: "",
  default_location: "",
  link_pattern: "",
  link_selector: "",
  description_selector: "",
  max_jobs: "60",
  enabled: true,
  contracts: false,
  notes: "",
};

type SourceFormState = typeof EMPTY_SOURCE_FORM;

function sourceToForm(src: JobSource): SourceFormState {
  return {
    name: src.name,
    urls: src.urls.join("\n"),
    default_company: src.default_company ?? "",
    default_location: src.default_location ?? "",
    link_pattern: src.link_pattern ?? "",
    link_selector: src.link_selector ?? "",
    description_selector: src.description_selector ?? "",
    max_jobs: String(src.max_jobs ?? 60),
    enabled: src.enabled,
    contracts: src.kind === "contract",
    notes: src.notes ?? "",
  };
}

function sourceToInput(src: JobSource): JobSourceInput {
  return {
    name: src.name,
    slug: src.slug,
    urls: src.urls,
    link_pattern: src.link_pattern ?? undefined,
    link_selector: src.link_selector ?? undefined,
    description_selector: src.description_selector ?? undefined,
    default_company: src.default_company ?? undefined,
    default_location: src.default_location ?? undefined,
    max_jobs: src.max_jobs,
    enabled: src.enabled,
    kind: src.kind,
    notes: src.notes ?? undefined,
  };
}

function LastRunCell({ run }: { run: SourceLastRun | null }) {
  if (!run) return <span className="text-xs text-muted-foreground">Never run</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <StatusBadge status={run.status} />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {run.jobs_found} found {"\u00b7"} {run.jobs_new} new
        </span>
      </div>
      <span className="text-xs text-muted-foreground">{formatDateTime(run.started_at)}</span>
      {run.error_message && (
        <span className="text-xs text-red-500 truncate max-w-[220px]" title={run.error_message}>{run.error_message}</span>
      )}
    </div>
  );
}

function SourceForm({ initial, onSaved, onCancel }: {
  initial: JobSource | null;
  onSaved: (source: JobSource) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SourceFormState>(initial ? sourceToForm(initial) : EMPTY_SOURCE_FORM);
  const [showAdvanced, setShowAdvanced] = useState(Boolean(initial && (initial.link_pattern || initial.link_selector || initial.description_selector)));
  const [saving, setSaving] = useState(false);

  const update = (field: keyof SourceFormState, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const urls = form.urls.split(/\r?\n/).map((u) => u.trim()).filter(Boolean);
    if (!form.name.trim()) return toast.error("Give the source a name");
    if (urls.length === 0) return toast.error("Add at least one listing URL");
    const bad = urls.find((u) => !/^https?:\/\//i.test(u));
    if (bad) return toast.error(`URLs must start with http:// or https:// (${bad})`);
    const maxJobs = Number(form.max_jobs) || 60;

    const payload: JobSourceInput = {
      name: form.name.trim(),
      slug: initial?.slug,
      urls,
      default_company: form.default_company.trim() || undefined,
      default_location: form.default_location.trim() || undefined,
      link_pattern: form.link_pattern.trim() || undefined,
      link_selector: form.link_selector.trim() || undefined,
      description_selector: form.description_selector.trim() || undefined,
      max_jobs: Math.min(500, Math.max(1, maxJobs)),
      enabled: form.enabled,
      kind: form.contracts ? "contract" : "job",
      notes: form.notes.trim() || undefined,
    };

    setSaving(true);
    try {
      const saved = initial ? await updateJobSource(initial.id, payload) : await createJobSource(payload);
      toast.success(initial ? `Updated ${saved.name}` : `Added ${saved.name}. It will be included in the next automatic scrape.`);
      onSaved(saved);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save source"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-primary/40 rounded-xl p-4 sm:p-6 mb-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-heading font-semibold">{initial ? `Edit ${initial.name}` : "Add a job source"}</h3>
          <p className="text-xs text-muted-foreground">
            Paste the page that lists the jobs. The scraper finds the job links on it, opens each one and saves the
            title, company, location and description. Use the advanced options if a site needs a hint.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="p-1.5 rounded-lg hover:bg-muted" aria-label="Close form"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Source name *</label>
            <input type="text" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. NaukriGulf" className={inputClass} />
            {initial && <p className="text-xs text-muted-foreground mt-1">Stored as source <code className="font-mono">{initial.slug}</code>; the slug does not change when renaming.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Listing page URL(s) *</label>
            <textarea
              value={form.urls}
              onChange={(e) => update("urls", e.target.value)}
              rows={3}
              placeholder={"One per line, e.g.\nhttps://www.naukrigulf.com/jobs-in-kenya"}
              className={`${inputClass} resize-y font-mono text-xs`}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Default company</label>
              <input type="text" value={form.default_company} onChange={(e) => update("default_company", e.target.value)} placeholder="For a single company's careers page" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Default location</label>
              <input type="text" value={form.default_location} onChange={(e) => update("default_location", e.target.value)} placeholder="e.g. Nairobi, Kenya" className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium mb-1">Max jobs per run</label>
              <input type="number" min={1} max={500} value={form.max_jobs} onChange={(e) => update("max_jobs", e.target.value)} className={inputClass} />
            </div>
            <label className="flex items-center gap-2 text-sm font-medium pb-2">
              <input type="checkbox" checked={form.enabled} onChange={(e) => update("enabled", e.target.checked)} className="rounded" />
              Enabled (included in the daily scrape)
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm font-medium">
            <input type="checkbox" checked={form.contracts} onChange={(e) => update("contracts", e.target.checked)} className="rounded mt-0.5" />
            <span>
              This source lists contracts / consultancies
              <span className="block text-xs font-normal text-muted-foreground">Terms of reference, tenders, RFPs. Everything collected from it is filed under Contracts.</span>
            </span>
          </label>
        </div>

        <div className="space-y-4">
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-sm font-medium text-primary hover:underline">
            {showAdvanced ? "Hide" : "Show"} advanced options
          </button>
          {showAdvanced && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Job link pattern (regex)</label>
                <input type="text" value={form.link_pattern} onChange={(e) => update("link_pattern", e.target.value)} placeholder="e.g. -jid-|/job-detail/" className={`${inputClass} font-mono text-xs`} />
                <p className="text-xs text-muted-foreground mt-1">Only links matching this are treated as job pages. Leave blank to auto-detect links that look like jobs.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Job link CSS selector</label>
                <input type="text" value={form.link_selector} onChange={(e) => update("link_selector", e.target.value)} placeholder="e.g. .job-card a, h2.title a" className={`${inputClass} font-mono text-xs`} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description CSS selector (on the job page)</label>
                <input type="text" value={form.description_selector} onChange={(e) => update("description_selector", e.target.value)} placeholder="e.g. .job-description" className={`${inputClass} font-mono text-xs`} />
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={2} placeholder="Anything worth remembering about this source" className={`${inputClass} resize-y`} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-border">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80">Cancel</button>
        <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <PlusCircle size={16} />}
          {saving ? "Saving..." : initial ? "Save changes" : "Add source"}
        </button>
      </div>
    </form>
  );
}

const BUILTIN_PER_PAGE = 10;

function SourcesTab() {
  const queryClient = useQueryClient();
  const { data, loading, refresh } = useJobSourcesAdmin();
  const { nextRun } = useSchedulerStatus();
  const [editing, setEditing] = useState<JobSource | "new" | null>(null);
  const [builtinPage, setBuiltinPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<JobSource | null>(null);
  const [actingSlug, setActingSlug] = useState<string | null>(null);

  const running = new Set(data?.running_sources ?? []);
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "sources"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "scrape-logs"] });
  };

  const handleRun = async (slug: string) => {
    setActingSlug(slug);
    try {
      const result = await runSourceScrape(slug);
      toast.success(`${result.message}. The result will show under Scrape Logs.`);
      invalidate();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to start scrape"));
    } finally {
      setActingSlug(null);
    }
  };

  const handleToggle = async (src: JobSource) => {
    setActingSlug(src.slug);
    try {
      await updateJobSource(src.id, { ...sourceToInput(src), enabled: !src.enabled });
      toast.success(src.enabled ? `${src.name} disabled; it will be skipped by the daily scrape` : `${src.name} enabled`);
      invalidate();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to update source"));
    } finally {
      setActingSlug(null);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const src = pendingDelete;
    setPendingDelete(null);
    setActingSlug(src.slug);
    try {
      await deleteJobSource(src.id);
      toast.success(`Removed ${src.name}`);
      invalidate();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete source"));
    } finally {
      setActingSlug(null);
    }
  };

  const custom = data?.custom ?? [];
  const builtin = data?.builtin ?? [];
  const builtinPages = Math.max(1, Math.ceil(builtin.length / BUILTIN_PER_PAGE));
  const builtinVisible = builtin.slice((builtinPage - 1) * BUILTIN_PER_PAGE, builtinPage * BUILTIN_PER_PAGE);

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-heading font-bold text-lg">Job Sources</h2>
          <p className="text-sm text-muted-foreground">Built-in scrapers plus any job boards or careers pages you add here.</p>
          <NextRunNote nextRun={nextRun} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refresh()} className="p-2 rounded-lg border border-input hover:bg-muted" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setEditing("new")}
            disabled={editing === "new"}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <PlusCircle size={16} /> Add Source
          </button>
        </div>
      </div>

      {editing !== null && (
        <SourceForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          onSaved={() => { setEditing(null); invalidate(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      <h3 className="font-heading font-semibold text-sm mb-2">Your sources ({custom.length})</h3>
      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
      ) : custom.length === 0 ? (
        <div className="bg-card border border-dashed border-border rounded-xl text-center py-10 text-muted-foreground mb-8">
          <Globe size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No custom sources yet.</p>
          <p className="text-xs mt-1">Add a job board or careers page and it will be scraped automatically every day.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">Source</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Listing page</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Status</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Last run</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {custom.map((src) => {
                  const isRunning = running.has(src.slug);
                  const busy = actingSlug === src.slug;
                  return (
                    <tr key={src.id} className={`border-b border-border last:border-0 hover:bg-muted/50 ${busy ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium flex items-center gap-2">
                          {src.name}
                          {src.kind === "contract" && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700"><FileText size={9} /> Contracts</span>}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">{src.slug}</div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs">
                        <a href={src.urls[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline max-w-[280px] truncate">
                          <span className="truncate">{src.urls[0]}</span><ExternalLink size={11} className="shrink-0" />
                        </a>
                        {src.urls.length > 1 && <div className="text-muted-foreground mt-0.5">+{src.urls.length - 1} more</div>}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {isRunning ? <StatusBadge status="running" /> : (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${src.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                            {src.enabled ? "Enabled" : "Disabled"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell"><LastRunCell run={src.last_run} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          <button onClick={() => handleRun(src.slug)} disabled={busy || isRunning} title="Scrape this source now" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed">
                            {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}<span className="hidden sm:inline">Run now</span>
                          </button>
                          <button onClick={() => setEditing(src)} disabled={busy} title="Edit" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-muted disabled:opacity-50">
                            <Pencil size={14} /><span className="hidden sm:inline">Edit</span>
                          </button>
                          <button onClick={() => handleToggle(src)} disabled={busy} title={src.enabled ? "Disable" : "Enable"} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-muted disabled:opacity-50">
                            <Power size={14} /><span className="hidden sm:inline">{src.enabled ? "Disable" : "Enable"}</span>
                          </button>
                          <button onClick={() => setPendingDelete(src)} disabled={busy} title="Delete" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                            <Trash2 size={14} /><span className="hidden sm:inline">Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h3 className="font-heading font-semibold text-sm mb-2">Built-in scrapers ({builtin.length})</h3>
      <p className="text-xs text-muted-foreground mb-3">These live in the code and always run with the daily scrape. Run one on its own to test it.</p>
      {!loading && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">Source</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Last run</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {builtinVisible.map((src) => {
                  const isRunning = running.has(src.slug);
                  return (
                    <tr key={src.slug} className="border-b border-border last:border-0 hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{src.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{src.slug}</div>
                      </td>
                      <td className="px-4 py-3"><LastRunCell run={src.last_run} /></td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <button onClick={() => handleRun(src.slug)} disabled={isRunning || actingSlug === src.slug} title="Scrape this source now" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 disabled:cursor-not-allowed">
                            {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run now
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PaginationBar page={builtinPage} pages={builtinPages} total={builtin.length} perPage={BUILTIN_PER_PAGE} onPageChange={setBuiltinPage} />
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Remove this source?"
        confirmLabel="Remove"
        onConfirm={handleDelete}
        description={pendingDelete ? `${pendingDelete.name} will no longer be scraped. Jobs already collected from it stay in the database until they expire.` : null}
      />
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-2xl font-bold font-heading">{typeof value === "number" ? value.toLocaleString() : value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default AdminDashboard;
