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
}

export interface Stats {
  total_jobs: number;
  active_jobs: number;
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

export interface FacetEntry {
  name: string;
  count: number;
}

import { useQuery, keepPreviousData, type UseQueryResult } from "@tanstack/react-query";

export const API_BASE = import.meta.env.VITE_API_URL ?? "https://api.careers.annex-technologies.com";

// --- Admin auth ---

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
  };
}

export interface JobsQueryParams {
  page?: number;
  perPage?: number;
  search?: string;
  location?: string;
  jobType?: string;
  remote?: boolean;
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

export function useScrapeLogsAdmin() {
  const query = useQuery({
    queryKey: ["admin", "scrape-logs"],
    queryFn: async () => {
      const res = await adminFetch(`/api/scrape-logs?limit=100`);
      const data = await res.json();
      return (data.logs ?? []) as ScrapeLogEntry[];
    },
  });
  return { logs: query.data ?? [], loading: query.isLoading, refresh: query.refetch };
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
    refresh: query.refetch,
  };
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

export async function triggerScrapeAll(): Promise<{ total_found: number }> {
  const res = await adminFetch(`/api/scrape-all`, { method: "POST" });
  if (!res.ok) throw new Error("Scrape failed");
  return res.json();
}

export async function createJob(data: {
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
}): Promise<{ message: string; job_id: number }> {
  const res = await adminFetch(`/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to create job");
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

export async function generateAtsCv(file: File, jobId?: string): Promise<{ blob: Blob; filename: string }> {
  const form = new FormData();
  form.append("file", file);
  if (jobId) form.append("job_id", jobId);
  const res = await fetch(`${API_BASE}/api/cv/generate`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to generate CV");
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : "ATS_CV.pdf";
  const blob = await res.blob();
  return { blob, filename };
}
