import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  LogOut, LayoutDashboard, Mail, Activity, Search,
  ChevronDown, ChevronUp, Loader2, Send, RefreshCw,
  Users, Menu, X, PlusCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  useAllJobs, useStats,
  useScrapeLogsAdmin, useUsersAdmin,
  sendBulkAlerts, triggerScrapeAll, createJob,
  getAdminToken, clearAdminToken,
} from "@/lib/jobStore";
import { isValidLocation } from "@/lib/locationUtils";

type Tab = "dashboard" | "addjob" | "emails" | "logs";

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
          {tab === "emails" && <EmailTriggerTab />}
          {tab === "logs" && <ScrapeLogsTab />}
        </div>
      </main>
    </div>
  );
};

function DashboardTab() {
  const { jobs: allJobs, isLoading: jobsLoading } = useAllJobs();
  const { stats } = useStats();
  const [jobSearch, setJobSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const INITIAL_COUNT = 20;

  const locationCounts = useMemo(() => {
    const map: Record<string, number> = {};
    allJobs.forEach((j) => {
      if (j.location && isValidLocation(j.location)) {
        const loc = j.location.trim();
        map[loc] = (map[loc] || 0) + 1;
      }
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [allJobs]);

  const filteredJobs = useMemo(() => {
    if (!jobSearch.trim()) return allJobs;
    const q = jobSearch.toLowerCase();
    return allJobs.filter(
      (j) =>
        j.title.toLowerCase().includes(q) ||
        j.company.toLowerCase().includes(q) ||
        j.location.toLowerCase().includes(q)
    );
  }, [allJobs, jobSearch]);

  const visibleJobs = showAll ? filteredJobs : filteredJobs.slice(0, INITIAL_COUNT);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Jobs" value={stats?.total_jobs ?? allJobs.length} />
        <StatCard label="Active Jobs" value={stats?.active_jobs ?? allJobs.length} />
        <StatCard label="Sources" value={stats ? Object.keys(stats.sources).length : "\u2014"} />
        <StatCard label="Locations" value={locationCounts.length} />
      </div>

      <div className="bg-card border border-border rounded-xl p-4 mb-6">
        <h3 className="font-heading font-semibold text-sm mb-3">Jobs by Location</h3>
        <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
          {locationCounts.slice(0, 30).map(([loc, count]) => (
            <span key={loc} className="bg-muted px-3 py-1.5 rounded-full text-xs font-medium">
              {loc}: {count}
            </span>
          ))}
          {locationCounts.length > 30 && (
            <span className="bg-muted px-3 py-1.5 rounded-full text-xs font-medium text-muted-foreground">
              +{locationCounts.length - 30} more
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <h2 className="font-heading font-bold text-lg">All Jobs ({filteredJobs.length})</h2>
        <div className="relative w-full sm:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search jobs..."
            value={jobSearch}
            onChange={(e) => { setJobSearch(e.target.value); setShowAll(false); }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {jobsLoading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">Title</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Company</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Location</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Source</th>
                </tr>
              </thead>
              <tbody>
                {visibleJobs.map((job) => (
                  <tr key={job.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3 font-medium">
                      <div className="line-clamp-1">{job.title}</div>
                      <div className="text-xs text-muted-foreground sm:hidden">{job.company} \u00b7 {job.location}</div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{job.company}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{job.location}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground capitalize">{job.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredJobs.length > INITIAL_COUNT && (
            <div className="text-center mt-4">
              <button
                onClick={() => setShowAll(!showAll)}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-primary hover:underline"
              >
                {showAll ? <><ChevronUp size={16} /> Show Less</> : <><ChevronDown size={16} /> See More ({filteredJobs.length - INITIAL_COUNT} more)</>}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function AddJobTab() {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: "",
    company: "",
    location: "",
    description: "",
    requirements: "",
    job_type: "Full-time",
    experience_level: "",
    remote: false,
    apply_url: "",
    tags: "",
    application_deadline: "",
  });

  const update = (field: string, value: string | boolean) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error("Job title is required");
    setSubmitting(true);
    try {
      const result = await createJob({
        ...form,
        title: form.title.trim(),
        company: form.company.trim() || undefined,
        location: form.location.trim() || undefined,
        description: form.description.trim() || undefined,
        requirements: form.requirements.trim() || undefined,
        experience_level: form.experience_level.trim() || undefined,
        apply_url: form.apply_url.trim() || undefined,
        tags: form.tags.trim() || undefined,
        application_deadline: form.application_deadline || undefined,
      });
      toast.success(`Job created (ID: ${result.job_id})`);
      setForm({ title: "", company: "", location: "", description: "", requirements: "", job_type: "Full-time", experience_level: "", remote: false, apply_url: "", tags: "", application_deadline: "" });
    } catch (err: any) {
      toast.error(err.message || "Failed to create job");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="mb-6">
        <h2 className="font-heading font-bold text-lg">Add Job Manually</h2>
        <p className="text-sm text-muted-foreground">Post a job you found elsewhere so users can discover and apply</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-4 sm:p-6 space-y-4 max-w-2xl">
        <div>
          <label className="block text-sm font-medium mb-1">Job Title *</label>
          <input type="text" value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Junior Data Analyst" className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Company</label>
            <input type="text" value={form.company} onChange={(e) => update("company", e.target.value)} placeholder="e.g. Safaricom" className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Location</label>
            <input type="text" value={form.location} onChange={(e) => update("location", e.target.value)} placeholder="e.g. Nairobi, Kenya" className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Job Description</label>
          <textarea value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Paste the job description here..." rows={5} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Requirements</label>
          <textarea
            value={form.requirements}
            onChange={(e) => update("requirements", e.target.value)}
            placeholder={"One requirement per line, e.g.\nBachelor's degree in a related field\n3+ years of experience\nProficiency in SQL"}
            rows={4}
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y"
          />
          <p className="text-xs text-muted-foreground mt-1">One requirement per line. Shown as a bullet list on the job page.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Job Type</label>
            <select value={form.job_type} onChange={(e) => update("job_type", e.target.value)} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="Full-time">Full-time</option>
              <option value="Part-time">Part-time</option>
              <option value="Contract">Contract</option>
              <option value="Internship">Internship</option>
              <option value="Attachment">Attachment</option>
              <option value="Freelance">Freelance</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Experience Level</label>
            <select value={form.experience_level} onChange={(e) => update("experience_level", e.target.value)} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">Select...</option>
              <option value="Entry">Entry Level</option>
              <option value="Junior">Junior</option>
              <option value="Mid">Mid Level</option>
              <option value="Senior">Senior</option>
              <option value="Lead">Lead</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" id="remote" checked={form.remote} onChange={(e) => update("remote", e.target.checked)} className="rounded" />
          <label htmlFor="remote" className="text-sm font-medium">Remote position</label>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Application Link</label>
          <input type="url" value={form.apply_url} onChange={(e) => update("apply_url", e.target.value)} placeholder="https://company.com/apply" className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Tags</label>
            <input type="text" value={form.tags} onChange={(e) => update("tags", e.target.value)} placeholder="e.g. python, data, analytics" className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Application Deadline</label>
            <input type="date" value={form.application_deadline} onChange={(e) => update("application_deadline", e.target.value)} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
        </div>

        <div className="pt-2">
          <button type="submit" disabled={submitting} className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <PlusCircle size={16} />}
            {submitting ? "Adding..." : "Add Job"}
          </button>
        </div>
      </form>
    </>
  );
}

const USERS_PER_PAGE = 100;

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
    } catch (err: any) {
      toast.error(err.message || "Failed to send emails");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-heading font-bold text-lg">Email Trigger</h2>
          <p className="text-sm text-muted-foreground">Manage subscribers and send job alert emails</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="p-2 rounded-lg border border-input hover:bg-muted" title="Refresh">
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
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
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
                  <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{user.name || "\u2014"}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      user.source === "subscribe" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
                    }`}>
                      {user.source === "subscribe" ? "Subscriber" : "CV Upload"}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">{user.job_interests || "\u2014"}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                    {user.last_emailed_at ? new Date(user.last_emailed_at).toLocaleDateString() : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2 py-3 border-t border-border">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-muted disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted/80"
              >
                Previous
              </button>
              <span className="text-xs text-muted-foreground px-2">Page {page} of {pages}</span>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ScrapeLogsTab() {
  const { logs, loading, refresh } = useScrapeLogsAdmin();
  const [scraping, setScraping] = useState(false);

  const handleRunScrape = async () => {
    setScraping(true);
    try {
      const result = await triggerScrapeAll();
      toast.success(`Scrape complete: ${result.total_found} jobs found`);
      refresh();
    } catch (err: any) {
      toast.error(err.message || "Scrape failed");
    } finally {
      setScraping(false);
    }
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-heading font-bold text-lg">Scrape Logs</h2>
          <p className="text-sm text-muted-foreground">View scraping history and trigger manual scrapes</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="p-2 rounded-lg border border-input hover:bg-muted" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={handleRunScrape}
            disabled={scraping}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {scraping ? <Loader2 size={16} className="animate-spin" /> : <Activity size={16} />}
            {scraping ? "Scraping..." : "Run Scrape Now"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Activity size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No scrape logs yet</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">Source</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Found</th>
                <th className="px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">New</th>
                <th className="px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Started</th>
                <th className="px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium capitalize">{log.source}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      log.status === "success" ? "bg-green-100 text-green-700" :
                      log.status === "failed" ? "bg-red-100 text-red-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{log.jobs_found}</td>
                  <td className="px-4 py-3 hidden sm:table-cell">{log.jobs_new}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                    {log.started_at ? new Date(log.started_at).toLocaleString() : "\u2014"}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-xs text-red-500 max-w-[200px] truncate">
                    {log.error_message || "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
