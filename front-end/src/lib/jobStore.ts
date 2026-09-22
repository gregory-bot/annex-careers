export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  salary_min: number | null;
  type: string;
  posted: string;
  source: string;
  description: string;
  requirements: string[];
  category: string;
  url: string;
  apply_url: string;
  application_deadline: string;
  is_active: boolean;
  remote: boolean;
  scraped_at: string;
  /** "job" (default) or "contract": consultancies, TOR-based assignments, tenders. */
  kind: "job" | "contract";
  tor_url: string;
  duration: string;
  budget: string;
  attachments: Attachment[];
  /** Paid placement: pinned to the top of listings until this time. */
  featured_until: string;
  is_featured: boolean;
}

export type ListingKind = "job" | "contract";

/** A poster image or TOR / contract document attached to a listing. `url` is API-relative; use fileUrl(). */
export interface Attachment {
  id: number;
  url: string;
  filename: string;
  content_type: string;
  size: number;
  kind: "image" | "document";
}

export interface Stats {
  total_jobs: number;
  active_jobs: number;
  active_contracts?: number;
  remote_jobs: number;
  job_type_counts: Record<string, number>;
  companies: number;
  sources: Record<string, number>;
  recent_scrapes: Array<{
    source: string;
    status: string;
    jobs_found: number;
    started_at: string | null;
  }>;
}

export interface AdminAnalytics {
  page_views: { total: number; today: number; this_week: number };
  apply_clicks: { total: number; today: number; this_week: number };
  job_types: Array<{ name: string; count: number }>;
  sources: Array<{ name: string; count: number }>;
  top_jobs: Array<{ id: number; title: string; company: string | null; job_type: string | null; count: number }>;
}

export interface FacetEntry {
  name: string;
  count: number;
}

import { useQuery, keepPreviousData, type UseQueryResult } from "@tanstack/react-query";

// Production builds read VITE_API_URL from the repo-root .env.production; local dev from .env.
// The fallback is the live Render API.
export const API_BASE = (import.meta.env.VITE_API_URL ?? "https://annex-careers.onrender.com").replace(/\/+$/, "");

// --- Admin auth ---

async function readError(res: Response, fallback: string) {
  return (await res.json().catch(() => ({}))).detail || fallback;
}

const ADMIN_TOKEN_KEY = "annex_admin_token";

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearAdminToken() {
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export async function adminLogin(username: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Invalid credentials");
  const data = await res.json();
  sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
}

/** fetch() wrapper for admin-only endpoints: attaches the bearer token and,
 * on a 401 (missing/expired/invalid token), clears it and bounces to login. */
async function adminFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getAdminToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearAdminToken();
    if (typeof window !== "undefined") window.location.href = "/admin";
  }
  return res;
}

function mapJob(j: any): Job {
  return {
    id: String(j.id),
    title: j.title ?? "",
    company: j.company ?? "",
    location: j.location ?? "",
    salary:
      j.salary_min && j.salary_max
        ? `${j.salary_currency ?? "KES"} ${j.salary_min.toLocaleString()} - ${j.salary_max.toLocaleString()}`
        : j.salary ?? "",
    salary_min: typeof j.salary_min === "number" ? j.salary_min : null,
    type: j.job_type ?? j.type ?? "",
    posted: j.posted_date ?? j.posted ?? "",
    source: j.source ?? "",
    description: j.description ?? "",
    requirements: typeof j.requirements === "string" && j.requirements
      ? j.requirements.split("\n").map((r: string) => r.trim()).filter(Boolean)
      : Array.isArray(j.requirements) ? j.requirements : [],
    category: j.category ?? j.tags ?? "",
    url: j.url ?? "",
    apply_url: j.apply_url ?? "",
    application_deadline: j.application_deadline ?? "",
    is_active: j.is_active ?? true,
    remote: j.remote ?? false,
    scraped_at: j.scraped_at ?? "",
    kind: j.kind === "contract" ? "contract" : "job",
    tor_url: j.tor_url ?? "",
    duration: j.duration ?? "",
    budget: j.budget ?? "",
    attachments: Array.isArray(j.attachments) ? j.attachments : [],
    featured_until: j.featured_until ?? "",
    is_featured: Boolean(j.is_featured),
  };
}

/** Absolute URL for an API-served file such as an attachment. */
export function fileUrl(path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${API_BASE}${path}`;
}

export interface JobsQueryParams {
  page?: number;
  perPage?: number;
  search?: string;
  location?: string;
  jobType?: string;
  remote?: boolean;
  /** Defaults to "job" on the server; pass "contract" for the Contracts page. */
  kind?: ListingKind | "all";
  featured?: boolean;
  sortBy?: "scraped_at" | "posted_date" | "title" | "company" | "salary_min";
  sortOrder?: "asc" | "desc";
}

export interface JobsPage {
  jobs: Job[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
}

function jobsQueryKey(params: JobsQueryParams) {
  return ["jobs", params] as const;
}

async function fetchJobsPage(params: JobsQueryParams): Promise<JobsPage> {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page ?? 1));
  qs.set("per_page", String(params.perPage ?? 20));
  if (params.search) qs.set("search", params.search);
  if (params.location) qs.set("location", params.location);
  if (params.jobType) qs.set("job_type", params.jobType);
  if (params.remote !== undefined) qs.set("remote", String(params.remote));
  if (params.kind) qs.set("kind", params.kind);
  if (params.featured) qs.set("featured", "true");
  if (params.sortBy) qs.set("sort_by", params.sortBy);
  if (params.sortOrder) qs.set("sort_order", params.sortOrder);

  const res = await fetch(`${API_BASE}/api/jobs?${qs.toString()}`);
  const data = await res.json();
  const rawJobs = data.jobs ?? data;
  return {
    jobs: Array.isArray(rawJobs) ? rawJobs.map(mapJob) : [],
    total: data.total ?? 0,
    page: data.page ?? params.page ?? 1,
    pages: data.pages ?? 1,
    perPage: data.per_page ?? params.perPage ?? 20,
  };
}

/** Paginated/filtered job listing, driven by the backend's real query params. */
export function useJobs(params: JobsQueryParams = {}): UseQueryResult<JobsPage> & { jobs: Job[] } {
  const query = useQuery({
    queryKey: jobsQueryKey(params),
    queryFn: () => fetchJobsPage(params),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  return { ...query, jobs: query.data?.jobs ?? [] };
}

/**
 * The full active-job set, for the handful of places that legitimately need
 * to look across everything (CV job-matching, "similar jobs"). Shared/cached
 * via react-query instead of being re-fetched on every mount.
 */
export function useAllJobs() {
  return useJobs({ perPage: 500 });
}

async function fetchJob(id: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/api/jobs/${id}`);
  if (!res.ok) throw new Error("Job not found");
  return mapJob(await res.json());
}

/** A single job by id — hits the dedicated backend endpoint instead of
 * downloading the whole job list to find one row. */
export function useJob(id: string | undefined) {
  const query = useQuery({
    queryKey: ["job", id],
    queryFn: () => fetchJob(id as string),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
  return { ...query, job: query.data };
}

async function fetchFacet(path: string, limit?: number): Promise<FacetEntry[]> {
  const qs = limit ? `?limit=${limit}` : "";
  const res = await fetch(`${API_BASE}${path}${qs}`);
  const data = await res.json();
  const key = path.replace("/api/", "");
  return data[key] ?? [];
}

export function useCategories(limit?: number) {
  const query = useQuery({
    queryKey: ["categories", limit],
    queryFn: () => fetchFacet("/api/categories", limit),
    staleTime: 10 * 60_000,
  });
  return { ...query, categories: query.data ?? [] };
}

export function useLocations(limit?: number) {
  const query = useQuery({
    queryKey: ["locations", limit],
    queryFn: () => fetchFacet("/api/locations", limit),
    staleTime: 10 * 60_000,
  });
  return { ...query, locations: query.data ?? [] };
}

export function useCompanies(limit?: number) {
  const query = useQuery({
    queryKey: ["companies", limit],
    queryFn: () => fetchFacet("/api/companies", limit),
    staleTime: 10 * 60_000,
  });
  return { ...query, companies: query.data ?? [] };
}

export function useStats(): { stats: Stats | null; loading: boolean } {
  const query = useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/stats`);
      return res.json() as Promise<Stats>;
    },
    staleTime: 60_000,
  });
  return { stats: query.data ?? null, loading: query.isLoading };
}

export function useSources(): Record<string, number> {
  const query = useQuery({
    queryKey: ["sources"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/sources`);
      const data = await res.json();
      return data.sources ?? {};
    },
    staleTime: 60_000,
  });
  return query.data ?? {};
}

// --- Admin API helpers ---

export interface ScrapeLogEntry {
  id: number;
  source: string;
  status: string;
  jobs_found: number;
  jobs_new: number;
  jobs_updated: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface UserEntry {
  id: number;
  email: string;
  name: string | null;
  source: string;
  job_interests: string | null;
  subscribed_at: string | null;
  last_emailed_at: string | null;
}

export interface ScrapeLogsPage {
  logs: ScrapeLogEntry[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
  inProgress: boolean;
  runningSources: string[];
}

/** A "running" row older than this is a crashed run, not a live one. */
const SCRAPE_RUNNING_STALE_MS = 2 * 60 * 60 * 1000;

/** Paginated scrape history. Polls while any scrape is in progress so rows
 * appear as each source finishes. */
export function useScrapeLogsAdmin(page = 1, perPage = 10, source?: string) {
  const query = useQuery({
    queryKey: ["admin", "scrape-logs", page, perPage, source ?? null],
    queryFn: async (): Promise<ScrapeLogsPage> => {
      const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (source) qs.set("source", source);
      const res = await adminFetch(`/api/scrape-logs?${qs.toString()}`);
      if (!res.ok) throw new Error("Failed to load scrape logs");
      const data = await res.json();
      const logs = (data.logs ?? []) as ScrapeLogEntry[];
      // The server flag covers runs this API process started; the log scan
      // also catches runs started elsewhere (the scheduler, another worker).
      const recentlyRunning = logs.some(
        (l) => l.status === "running" && l.started_at
          && Date.now() - new Date(l.started_at).getTime() < SCRAPE_RUNNING_STALE_MS,
      );
      return {
        logs,
        total: data.total ?? logs.length,
        page: data.page ?? page,
        pages: data.pages ?? 1,
        perPage: data.per_page ?? perPage,
        inProgress: Boolean(data.in_progress) || recentlyRunning,
        runningSources: data.running_sources ?? [],
      };
    },
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.inProgress ? 5000 : false),
  });
  return {
    logs: query.data?.logs ?? [],
    total: query.data?.total ?? 0,
    pages: query.data?.pages ?? 1,
    inProgress: query.data?.inProgress ?? false,
    runningSources: query.data?.runningSources ?? [],
    loading: query.isLoading,
    fetching: query.isFetching,
    refresh: () => query.refetch(),
  };
}

/** The API's built-in scheduler: tells the admin when the next automatic
 * scrape will run. */
export function useSchedulerStatus() {
  const query = useQuery({
    queryKey: ["admin", "scheduler"],
    queryFn: async (): Promise<{ running: boolean; nextRun: string | null }> => {
      const res = await adminFetch("/api/scheduler");
      if (!res.ok) throw new Error("Failed to load scheduler status");
      const data = await res.json();
      const daily = (data.jobs ?? []).find((j: { id: string }) => j.id === "daily_scrape");
      // APScheduler prints "YYYY-MM-DD HH:MM:SS+00:00"; make it ISO for Date().
      const nextRun = daily?.next_run ? String(daily.next_run).replace(" ", "T") : null;
      return { running: Boolean(data.running), nextRun };
    },
    staleTime: 60_000,
  });
  return { running: query.data?.running ?? false, nextRun: query.data?.nextRun ?? null };
}

// --- Banner ads (sold directly, managed from the admin) ---

export type AdPlacement = "home" | "jobs_list" | "contracts_list" | "job_sidebar";

export interface PublicAd {
  id: number;
  image: string;
  link_url: string;
  headline: string | null;
  advertiser: string | null;
  weight: number;
}

/** Live ads for one placement; the banner component picks one by weight. */
export function usePlacementAds(placement: AdPlacement) {
  const query = useQuery({
    queryKey: ["ads", placement],
    queryFn: async (): Promise<PublicAd[]> => {
      const res = await fetch(`${API_BASE}/api/ads?placement=${placement}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.ads ?? [];
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { ads: query.data ?? [], loading: query.isLoading };
}

function postAdEvent(id: number, event: "impression" | "click") {
  return fetch(`${API_BASE}/api/ads/${id}/${event}`, { method: "POST", keepalive: true }).catch(() => undefined);
}
export const recordAdImpression = (id: number) => postAdEvent(id, "impression");
export const recordAdClick = (id: number) => postAdEvent(id, "click");

export interface Ad {
  id: number;
  name: string;
  advertiser: string | null;
  placement: AdPlacement;
  headline: string | null;
  link_url: string;
  image_url: string | null;
  image_attachment_id: number | null;
  image: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  weight: number;
  status: "active" | "paused" | "scheduled" | "expired";
  impressions: number;
  clicks: number;
  ctr: number;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AdInput {
  name: string;
  advertiser?: string;
  placement: AdPlacement;
  headline?: string;
  link_url: string;
  image_url?: string;
  image_attachment_id?: number | null;
  starts_at?: string;
  ends_at?: string;
  is_active?: boolean;
  weight?: number;
  notes?: string;
}

export function useAdsAdmin() {
  const query = useQuery({
    queryKey: ["admin", "ads"],
    queryFn: async (): Promise<{ ads: Ad[]; placements: Record<AdPlacement, string> }> => {
      const res = await adminFetch("/api/admin/ads");
      if (!res.ok) throw new Error(await readError(res, "Failed to load ads"));
      return res.json();
    },
  });
  return {
    ads: query.data?.ads ?? [],
    placements: query.data?.placements ?? ({} as Record<AdPlacement, string>),
    loading: query.isLoading,
    refresh: () => query.refetch(),
  };
}

export async function createAd(input: AdInput): Promise<Ad> {
  const res = await adminFetch("/api/admin/ads", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, "Failed to create ad"));
  return res.json();
}

export async function updateAd(id: number, input: AdInput): Promise<Ad> {
  const res = await adminFetch(`/api/admin/ads/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, "Failed to update ad"));
  return res.json();
}

export async function deleteAd(id: number): Promise<{ message: string }> {
  const res = await adminFetch(`/api/admin/ads/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res, "Failed to delete ad"));
  return res.json();
}

// --- Admin: automatic job-alert emails ---

export interface AlertsStatus {
  hour_utc: number;
  next_run: string | null;
  running: boolean;
  last_run_at: string | null;
  last_summary: { skipped: boolean; reason?: string; users: number; emailed: number; failed: number; jobs_sent: number } | null;
  last_error: string | null;
  email_configured: boolean;
}

export function useAlertsStatus() {
  const query = useQuery({
    queryKey: ["admin", "alerts"],
    queryFn: async (): Promise<AlertsStatus> => {
      const res = await adminFetch("/api/admin/alerts/status");
      if (!res.ok) throw new Error(await readError(res, "Failed to load alert status"));
      const data = await res.json();
      return { ...data, next_run: data.next_run ? String(data.next_run).replace(" ", "T") : null };
    },
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  return { status: query.data ?? null, loading: query.isLoading, refresh: () => query.refetch() };
}

export async function runAlertsNow(): Promise<{ message: string; started: boolean }> {
  const res = await adminFetch("/api/admin/alerts/run", { method: "POST" });
  if (!res.ok) throw new Error(await readError(res, "Failed to start job alerts"));
  return res.json();
}

// --- Admin job sources ---

export interface SourceLastRun {
  status: string;
  jobs_found: number;
  jobs_new: number;
  jobs_updated: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface BuiltinSource {
  slug: string;
  name: string;
  type: "builtin";
  last_run: SourceLastRun | null;
}

export interface JobSource {
  id: number;
  name: string;
  slug: string;
  type: "custom";
  urls: string[];
  link_pattern: string | null;
  link_selector: string | null;
  description_selector: string | null;
  default_company: string | null;
  default_location: string | null;
  max_jobs: number;
  enabled: boolean;
  kind: ListingKind;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_run: SourceLastRun | null;
}

export interface JobSourceInput {
  name: string;
  slug?: string;
  urls: string[];
  link_pattern?: string;
  link_selector?: string;
  description_selector?: string;
  default_company?: string;
  default_location?: string;
  max_jobs?: number;
  enabled?: boolean;
  kind?: ListingKind;
  notes?: string;
}

export interface SourcesPayload {
  builtin: BuiltinSource[];
  custom: JobSource[];
  running_sources: string[];
  full_scrape_running: boolean;
}

export function useJobSourcesAdmin() {
  const query = useQuery({
    queryKey: ["admin", "sources"],
    queryFn: async (): Promise<SourcesPayload> => {
      const res = await adminFetch("/api/admin/sources");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to load sources");
      const data = await res.json();
      return {
        builtin: data.builtin ?? [],
        custom: data.custom ?? [],
        running_sources: data.running_sources ?? [],
        full_scrape_running: Boolean(data.full_scrape_running),
      };
    },
    // Poll while a per-source scrape is running so "last run" fills in.
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && (d.running_sources.length > 0 || d.full_scrape_running) ? 5000 : false;
    },
  });
  return { data: query.data, loading: query.isLoading, refresh: () => query.refetch() };
}

export async function createJobSource(input: JobSourceInput): Promise<JobSource> {
  const res = await adminFetch("/api/admin/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, "Failed to add source"));
  return res.json();
}

export async function updateJobSource(id: number, input: JobSourceInput): Promise<JobSource> {
  const res = await adminFetch(`/api/admin/sources/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, "Failed to update source"));
  return res.json();
}

export async function deleteJobSource(id: number): Promise<{ message: string; slug: string }> {
  const res = await adminFetch(`/api/admin/sources/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res, "Failed to delete source"));
  return res.json();
}

/** Scrape one source (built-in or custom) in the background. */
export async function runSourceScrape(slug: string): Promise<{ message: string; started: boolean; source: string }> {
  const res = await adminFetch(`/api/admin/scrape/${encodeURIComponent(slug)}`, { method: "POST" });
  if (!res.ok) throw new Error(await readError(res, "Failed to start scrape"));
  return res.json();
}

export interface UsersPage {
  users: UserEntry[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
}

export function useUsersAdmin(page = 1, perPage = 50, source?: string) {
  const query = useQuery({
    queryKey: ["admin", "users", page, perPage, source],
    queryFn: async (): Promise<UsersPage> => {
      const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (source) qs.set("source", source);
      const res = await adminFetch(`/api/users?${qs.toString()}`);
      const data = await res.json();
      return {
        users: data.users ?? [],
        total: data.total ?? 0,
        page: data.page ?? page,
        pages: data.pages ?? 1,
        perPage: data.per_page ?? perPage,
      };
    },
    placeholderData: keepPreviousData,
  });
  return {
    users: query.data?.users ?? [],
    total: query.data?.total ?? 0,
    pages: query.data?.pages ?? 1,
    loading: query.isLoading,
    refresh: () => query.refetch(),
  };
}

// --- Admin job management ---

export interface AdminJobsParams {
  page?: number;
  perPage?: number;
  search?: string;
  status?: "all" | "active" | "inactive";
  kind?: "all" | ListingKind;
  featured?: boolean;
  source?: string;
}

/** Every job in the database (no public-visibility filter), paginated and
 * searched server-side so the admin table never downloads the whole set. */
export function useAdminJobs(params: AdminJobsParams = {}) {
  const query = useQuery({
    queryKey: ["admin", "jobs", params],
    queryFn: async (): Promise<JobsPage> => {
      const qs = new URLSearchParams();
      qs.set("page", String(params.page ?? 1));
      qs.set("per_page", String(params.perPage ?? 10));
      if (params.search) qs.set("search", params.search);
      if (params.status && params.status !== "all") qs.set("status", params.status);
      if (params.kind && params.kind !== "all") qs.set("kind", params.kind);
      if (params.featured) qs.set("featured", "true");
      if (params.source) qs.set("source", params.source);
      const res = await adminFetch(`/api/admin/jobs?${qs.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to load jobs");
      const data = await res.json();
      return {
        jobs: (data.jobs ?? []).map(mapJob),
        total: data.total ?? 0,
        page: data.page ?? params.page ?? 1,
        pages: data.pages ?? 1,
        perPage: data.per_page ?? params.perPage ?? 10,
      };
    },
    placeholderData: keepPreviousData,
  });
  return {
    ...query,
    jobs: query.data?.jobs ?? [],
    total: query.data?.total ?? 0,
    pages: query.data?.pages ?? 1,
  };
}

export async function deleteJob(id: string): Promise<{ message: string; job_id: number }> {
  const res = await adminFetch(`/api/admin/jobs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to delete job");
  return res.json();
}

/** Paid placement: pin a listing to the top of its list for `days` days (extends if already featured). */
export async function featureJob(id: string, days: number): Promise<{ message: string; job: Job }> {
  const res = await adminFetch(`/api/admin/jobs/${id}/feature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to feature listing");
  const body = await res.json();
  return { message: body.message, job: mapJob(body.job) };
}

export async function unfeatureJob(id: string): Promise<{ message: string }> {
  const res = await adminFetch(`/api/admin/jobs/${id}/feature`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to unfeature listing");
  return res.json();
}

export async function repostJob(id: string): Promise<{ message: string; deadline_cleared: boolean }> {
  const res = await adminFetch(`/api/admin/jobs/${id}/repost`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to repost job");
  return res.json();
}

export function useAdminAnalytics() {
  const query = useQuery({
    queryKey: ["admin", "analytics"],
    queryFn: async (): Promise<AdminAnalytics> => {
      const res = await adminFetch("/api/admin/analytics");
      if (!res.ok) throw new Error("Failed to load analytics");
      return res.json();
    },
    staleTime: 60_000,
  });
  return { analytics: query.data ?? null, loading: query.isLoading, refresh: query.refetch };
}

export function trackAnalyticsEvent(eventType: "page_view" | "apply_click", jobId?: string) {
  const sessionKey = "annex_analytics_session";
  let sessionId = "";
  try {
    sessionId = sessionStorage.getItem(sessionKey) ?? crypto.randomUUID();
    sessionStorage.setItem(sessionKey, sessionId);
  } catch {
    // Analytics should never block browsing when storage is unavailable.
  }

  return fetch(`${API_BASE}/api/analytics/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: eventType, job_id: jobId ? Number(jobId) : undefined, session_id: sessionId, referrer: document.referrer || undefined }),
    keepalive: true,
  }).catch(() => undefined);
}

export async function sendBulkAlerts(userIds: number[]): Promise<{ sent: number }> {
  const res = await adminFetch(`/api/users/send-alerts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_ids: userIds }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
  return res.json();
}

/** Starts a full scrape in the background; the API returns immediately and
 * each source's result lands in the scrape logs as it finishes. */
export async function triggerScrapeAll(): Promise<{ message: string; started: boolean; sources: number }> {
  const res = await adminFetch(`/api/scrape-all`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to start scrape");
  return res.json();
}

export interface JobInput {
  title: string;
  company?: string;
  location?: string;
  description?: string;
  requirements?: string;
  job_type?: string;
  experience_level?: string;
  remote?: boolean;
  apply_url?: string;
  tags?: string;
  application_deadline?: string;
  kind?: ListingKind;
  tor_url?: string;
  duration?: string;
  budget?: string;
  /** Files uploaded via uploadListingFile() before saving; linked to the listing on create. */
  attachment_ids?: number[];
}

/** Result of uploading a poster / document: the stored file plus what we could read from it. */
export interface UploadResult extends Attachment {
  extracted_text: string;
  read: boolean;
  ocr_available: boolean;
  suggested: Partial<{
    title: string; company: string; location: string; job_type: string; apply_url: string;
    application_deadline: string; description: string; kind: ListingKind; positions: string[];
  }>;
}

/** Upload a poster image or TOR / contract document as the admin or as a signed-in employer.
 * Pass `extract: false` for banner creatives, which don't need their text read. */
export async function uploadListingFile(file: File, as: "admin" | "employer", options: { extract?: boolean } = {}): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const path = options.extract === false ? "/api/uploads?extract=false" : "/api/uploads";
  // No Content-Type header: the browser must set the multipart boundary itself.
  const res = as === "admin"
    ? await adminFetch(path, { method: "POST", body: form })
    : await employerFetch(path, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Upload failed");
  return res.json();
}

export async function createJob(data: JobInput): Promise<{ message: string; job_id: number }> {
  const res = await adminFetch(`/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to create job");
  return res.json();
}

// --- Employer portal (company side) ---
// A company invited by the admin signs in with its email + access code and
// gets a token that only works on /api/employer/* endpoints.

const EMPLOYER_TOKEN_KEY = "annex_employer_token";

export function getEmployerToken(): string | null {
  try {
    return sessionStorage.getItem(EMPLOYER_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearEmployerToken() {
  try {
    sessionStorage.removeItem(EMPLOYER_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export interface EmployerSession {
  company_name: string;
  contact_name: string | null;
}

export async function employerLogin(email: string, accessCode: string): Promise<EmployerSession> {
  const res = await fetch(`${API_BASE}/api/employer/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), access_code: accessCode.trim() }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Invalid email or access code");
  const data = await res.json();
  try {
    sessionStorage.setItem(EMPLOYER_TOKEN_KEY, data.token);
  } catch {
    // ignore: the session just won't survive a reload
  }
  return { company_name: data.company_name, contact_name: data.contact_name ?? null };
}

export class EmployerSessionError extends Error {}

async function employerFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getEmployerToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    clearEmployerToken();
    throw new EmployerSessionError((await res.json().catch(() => ({}))).detail || "Your session has ended. Please sign in again.");
  }
  return res;
}

/** A job with the engagement the company cares about: page views and Apply Now clicks. */
export interface EmployerJob extends Job {
  views: number;
  apply_clicks: number;
}

export interface EmployerMe {
  company_name: string;
  contact_name: string | null;
  email: string;
  expires_at: string | null;
  jobs: EmployerJob[];
}

export function useEmployerMe(enabled: boolean) {
  const query = useQuery({
    queryKey: ["employer", "me"],
    queryFn: async (): Promise<EmployerMe> => {
      const res = await employerFetch("/api/employer/me");
      if (!res.ok) throw new Error("Failed to load your details");
      const data = await res.json();
      const jobs: EmployerJob[] = (data.jobs ?? []).map((raw: { views?: number; apply_clicks?: number }) => ({
        ...mapJob(raw),
        views: raw.views ?? 0,
        apply_clicks: raw.apply_clicks ?? 0,
      }));
      return { ...data, jobs };
    },
    enabled,
    retry: false,
  });
  return { me: query.data ?? null, loading: query.isLoading, error: query.error, refresh: () => query.refetch() };
}

export async function createEmployerJob(data: JobInput): Promise<{ message: string; job: Job }> {
  const res = await employerFetch("/api/employer/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to publish job");
  const body = await res.json();
  return { message: body.message, job: mapJob(body.job) };
}

export async function closeEmployerJob(id: string): Promise<{ message: string }> {
  const res = await employerFetch(`/api/employer/jobs/${id}/close`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to close job");
  return res.json();
}

export async function repostEmployerJob(id: string): Promise<{ message: string; deadline_cleared: boolean }> {
  const res = await employerFetch(`/api/employer/jobs/${id}/repost`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to repost job");
  return res.json();
}

export async function deleteEmployerJob(id: string): Promise<{ message: string }> {
  const res = await employerFetch(`/api/employer/jobs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to delete job");
  return res.json();
}

// --- Admin: employer invites ---

export interface EmployerInvite {
  id: number;
  company_name: string;
  contact_name: string | null;
  email: string;
  status: "active" | "revoked";
  expired: boolean;
  note: string | null;
  created_at: string | null;
  expires_at: string | null;
  email_sent_at: string | null;
  last_login_at: string | null;
  jobs_posted: number;
}

/** Returned once, right after an invite is created or its code is reissued. */
export interface EmployerInviteIssued extends EmployerInvite {
  access_code: string;
  emailed: boolean;
  email_error: string | null;
  portal_url: string;
}

export interface EmployerInviteInput {
  company_name: string;
  email: string;
  contact_name?: string;
  note?: string;
  expires_in_days?: number | null;
  send_email?: boolean;
}

export function useEmployerInvitesAdmin() {
  const query = useQuery({
    queryKey: ["admin", "employers"],
    queryFn: async () => {
      const res = await adminFetch("/api/admin/employers");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to load employers");
      const data = await res.json();
      return {
        employers: (data.employers ?? []) as EmployerInvite[],
        portalUrl: String(data.portal_url ?? ""),
        emailConfigured: Boolean(data.email_configured),
      };
    },
  });
  return {
    employers: query.data?.employers ?? [],
    portalUrl: query.data?.portalUrl ?? "",
    emailConfigured: query.data?.emailConfigured ?? false,
    loading: query.isLoading,
    refresh: () => query.refetch(),
  };
}

export async function createEmployerInvite(input: EmployerInviteInput): Promise<EmployerInviteIssued> {
  const res = await adminFetch("/api/admin/employers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, "Failed to invite company"));
  return res.json();
}

export async function resendEmployerInvite(id: number, sendEmail = true): Promise<EmployerInviteIssued> {
  const res = await adminFetch(`/api/admin/employers/${id}/resend?send_email=${sendEmail}`, { method: "POST" });
  if (!res.ok) throw new Error(await readError(res, "Failed to issue a new code"));
  return res.json();
}

export async function updateEmployerInvite(
  id: number,
  patch: Partial<{ company_name: string; contact_name: string; email: string; note: string; status: "active" | "revoked"; expires_in_days: number }>,
): Promise<EmployerInvite> {
  const res = await adminFetch(`/api/admin/employers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readError(res, "Failed to update invite"));
  return res.json();
}

export async function deleteEmployerInvite(id: number): Promise<{ message: string }> {
  const res = await adminFetch(`/api/admin/employers/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res, "Failed to delete invite"));
  return res.json();
}

export async function registerUser(data: { email: string; name?: string; job_interests?: string }) {
  const res = await fetch(`${API_BASE}/api/users/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
  return res.json();
}

// --- CV engine (rule-based, server-side — see backend/api/cv/) ---

export interface CvAnalysisResult {
  type: "analysis";
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  recommendations: string[];
  matched_skills: string[];
  missing_skills: string[];
  candidate_name: string | null;
  candidate_email: string | null;
  parse_confidence: number;
  low_confidence: boolean;
}

export async function analyzeCv(file: File, jobId?: string): Promise<CvAnalysisResult> {
  const form = new FormData();
  form.append("file", file);
  if (jobId) form.append("job_id", jobId);
  // Never set Content-Type manually — the browser must set the multipart boundary itself.
  const res = await fetch(`${API_BASE}/api/cv/analyze`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to analyze CV");
  return res.json();
}

export async function generateAtsCv(file: File, jobId?: string, confirmedSkills?: string[]): Promise<{ blob: Blob; filename: string }> {
  const form = new FormData();
  form.append("file", file);
  if (jobId) form.append("job_id", jobId);
  if (confirmedSkills && confirmedSkills.length > 0) form.append("confirmed_skills", confirmedSkills.join(","));
  const res = await fetch(`${API_BASE}/api/cv/generate`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to generate CV");
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : "ATS_CV.pdf";
  const blob = await res.blob();
  return { blob, filename };
}
