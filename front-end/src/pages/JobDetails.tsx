import { useParams, Link } from "react-router-dom";
import { useEffect } from "react";
import { ArrowLeft, MapPin, Briefcase, Clock, ExternalLink, Share2, CalendarClock, Building2, Loader2, FileCheck, FileText, Hourglass, Wallet } from "lucide-react";
import Layout from "@/components/Layout";
import JobCard from "@/components/JobCard";
import { useJob, useAllJobs, trackAnalyticsEvent, fileUrl } from "@/lib/jobStore";
import { useDocumentMeta, excerpt } from "@/lib/seo";
import { toast } from "sonner";

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-KE", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Renders a job description as paragraphs plus real <ul> bullet lists for
 * any •/-/* prefixed lines, instead of dumping everything as one raw
 * whitespace-pre-line blob (which is what made pasted/manually-added job
 * ads look unformatted).
 */
function JobDescription({ description }: { description: string }) {
  const bulletRe = /^\s*[•\-*]\s+(.*)$/;
  type Block = { type: "ul"; items: string[] } | { type: "p"; lines: string[] };
  const blocks: Block[] = [];

  for (const rawLine of description.split("\n")) {
    const line = rawLine.trimEnd();
    const bulletMatch = line.match(bulletRe);
    const last = blocks[blocks.length - 1];
    if (bulletMatch) {
      const text = bulletMatch[1].trim();
      if (last?.type === "ul") last.items.push(text);
      else blocks.push({ type: "ul", items: [text] });
    } else if (line.trim() === "") {
      if (last?.type === "p") blocks.push({ type: "p", lines: [] });
    } else if (last?.type === "p") {
      last.lines.push(line);
    } else {
      blocks.push({ type: "p", lines: [line] });
    }
  }

  return (
    <>
      {blocks.map((block, i) =>
        block.type === "ul" ? (
          <ul key={i} className="space-y-2 mb-4">
            {block.items.map((item, j) => (
              <li key={j} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="w-1.5 h-1.5 bg-primary rounded-full shrink-0 mt-1.5" />
                {item}
              </li>
            ))}
          </ul>
        ) : block.lines.length > 0 ? (
          <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-4 whitespace-pre-line break-words">
            {block.lines.join("\n")}
          </p>
        ) : null
      )}
    </>
  );
}

const JobDetails = () => {
  const { id } = useParams();
  const { job, isLoading: loading } = useJob(id);
  const { jobs: allJobs } = useAllJobs();

  useEffect(() => {
    if (job) void trackAnalyticsEvent("page_view", job.id);
  }, [job]);

  // Title, description and share tags for this job (browsers, Google, bookmarks).
  const context = job
    ? [job.location, job.type, job.application_deadline ? `Deadline ${formatDate(job.application_deadline)}` : ""].filter(Boolean).join(" \u00b7 ")
    : "";
  useDocumentMeta(job ? {
    title: job.company ? `${job.title} at ${job.company}` : job.title,
    description: excerpt(`${context ? `${context}. ` : ""}${job.description || "View the full job details and apply directly on Annex Careers."}`),
    type: "article",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: job.title,
      description: excerpt(job.description, 5000) || job.title,
      url: `${window.location.origin}/jobs/${job.id}`,
      identifier: { "@type": "PropertyValue", name: "Annex Careers", value: job.id },
      hiringOrganization: { "@type": "Organization", name: job.company || "Company not listed" },
      ...(job.posted ? { datePosted: job.posted.slice(0, 10) } : {}),
      ...(job.application_deadline ? { validThrough: job.application_deadline } : {}),
      ...(job.type ? { employmentType: job.type.toUpperCase().replace(/[-\s]/g, "_") } : {}),
      ...(job.remote ? { jobLocationType: "TELECOMMUTE" } : {}),
      ...(job.location ? { jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: job.location } } } : {}),
      directApply: false,
    },
  } : null);

  if (loading) {
    return (
      <Layout>
        <div className="pt-32 sm:pt-36 container text-center pb-20 px-4 min-h-[60vh] flex flex-col items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
          <p className="text-sm text-muted-foreground">Loading job details...</p>
        </div>
      </Layout>
    );
  }

  if (!job) {
    return (
      <Layout>
        <div className="pt-32 sm:pt-36 container text-center pb-20 px-4 min-h-[60vh] flex flex-col items-center justify-center">
          <h1 className="font-heading text-2xl font-bold mb-4">Job not found</h1>
          <Link to="/jobs" className="text-primary hover:underline text-sm">← Back to jobs</Link>
        </div>
      </Layout>
    );
  }

  const similarJobs = allJobs.filter((j) => j.id !== job.id && (j.category === job.category || j.company === job.company)).slice(0, 3);

  const handleShare = async () => {
    const url = `${window.location.origin}/jobs/${job.id}`;
    const title = job.company ? `${job.title} at ${job.company}` : job.title;
    // Native share sheet on phones (WhatsApp, X, LinkedIn...); clipboard elsewhere.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: `${title} - via Annex Careers`, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard!");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  const applyLink = job.apply_url || job.url || "#";
  const isContract = job.kind === "contract";
  const posters = job.attachments.filter((a) => a.kind === "image");
  const documents = job.attachments.filter((a) => a.kind === "document");
  const torHref = job.tor_url || (isContract && documents[0] ? fileUrl(documents[0].url) : "");
  const hasDescription = job.description && job.description.trim().length > 0;
  const hasRequirements = job.requirements && job.requirements.length > 0;

  const handleApplyClick = () => {
    void trackAnalyticsEvent("apply_click", job.id);
  };

  return (
    <Layout>
      <div className="pt-28 md:pt-36 lg:pt-20">
        <div className="container py-6 sm:py-8 px-4">
          <Link to={isContract ? "/contracts" : "/jobs"} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 mt-2 block">
            <ArrowLeft size={16} /> {isContract ? "Back to contracts" : "Back to jobs"}
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
            {/* Main */}
            <div className="lg:col-span-2 min-w-0">
              <div className="bg-card border border-border rounded-xl p-4 sm:p-6 mb-6 overflow-hidden">
                {/* Company header */}
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-primary/10 text-primary font-heading font-bold flex items-center justify-center text-lg sm:text-xl shrink-0">
                    {job.company
                      ? job.company.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase()).join("")
                      : <Building2 size={22} />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-heading font-semibold text-sm sm:text-base text-foreground truncate">
                      {job.company || "Company not listed"}
                    </p>
                    <p className="text-xs text-muted-foreground">{isContract ? "Contracting organization" : "Hiring company"}</p>
                  </div>
                </div>

                {isContract && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 mb-2">
                    <FileText size={11} /> Contract / Consultancy
                  </span>
                )}
                <h1 className="font-heading text-lg sm:text-2xl font-bold mb-4">{job.title}</h1>

                <div className="flex flex-wrap gap-3 sm:gap-4 text-sm text-muted-foreground mb-4 sm:mb-6">
                  {job.location && <span className="flex items-center gap-1"><MapPin size={14} /> {job.location}</span>}
                  {job.type && <span className="flex items-center gap-1"><Briefcase size={14} /> {job.type}</span>}
                  {job.posted && <span className="flex items-center gap-1"><Clock size={14} /> Posted {formatDate(job.posted)}</span>}
                  {isContract && job.duration && <span className="flex items-center gap-1"><Hourglass size={14} /> {job.duration}</span>}
                  {isContract && job.budget && <span className="flex items-center gap-1"><Wallet size={14} /> {job.budget}</span>}
                  {job.application_deadline && (
                    <span className="flex items-center gap-1 text-orange-600">
                      <CalendarClock size={14} /> Deadline: {formatDate(job.application_deadline)}
                    </span>
                  )}
                </div>

                {job.salary && <p className="font-heading text-lg sm:text-xl font-bold text-primary mb-4 sm:mb-6">{job.salary}</p>}

                {posters.length > 0 && (
                  <div className="mb-6 space-y-3">
                    {posters.map((a) => (
                      <a key={a.id} href={fileUrl(a.url)} target="_blank" rel="noopener noreferrer" className="block" title="Open full size">
                        <img src={fileUrl(a.url)} alt={`${job.title} poster`} loading="lazy" className="w-full max-h-[640px] object-contain rounded-xl border border-border bg-muted" />
                      </a>
                    ))}
                  </div>
                )}

                <h2 className="font-heading font-semibold text-base sm:text-lg mb-3">{isContract ? "Scope of Work / Terms of Reference" : "Description"}</h2>
                {hasDescription ? (
                  <div className="mb-6 break-words overflow-hidden">
                    <JobDescription description={job.description} />
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground mb-6 bg-muted/50 rounded-lg p-4">
                    <p className="mb-2">No description available for this position.</p>
                    {applyLink !== "#" && (
                      <a href={applyLink} target="_blank" rel="noopener noreferrer" onClick={handleApplyClick} className="text-primary hover:underline font-medium inline-flex items-center gap-1">
                        <ExternalLink size={14} /> Click here for full job details
                      </a>
                    )}
                  </div>
                )}

                {hasRequirements ? (
                  <>
                    <h2 className="font-heading font-semibold text-base sm:text-lg mb-3">Requirements</h2>
                    <ul className="space-y-2 mb-6">
                      {job.requirements.map((req, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <span className="w-1.5 h-1.5 bg-primary rounded-full shrink-0 mt-1.5" />
                          {req}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    <h2 className="font-heading font-semibold text-base sm:text-lg mb-3">Requirements</h2>
                    <div className="text-sm text-muted-foreground mb-6 bg-muted/50 rounded-lg p-4">
                      <p className="mb-2">Requirements not listed for this position.</p>
                      {applyLink !== "#" && (
                        <a href={applyLink} target="_blank" rel="noopener noreferrer" onClick={handleApplyClick} className="text-primary hover:underline font-medium inline-flex items-center gap-1">
                          <ExternalLink size={14} /> Click here for full job details
                        </a>
                      )}
                    </div>
                  </>
                )}

                {job.category && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Tags:</span>
                    {job.category.split(",").map((tag) => (
                      <span key={tag.trim()} className="bg-muted px-2 py-0.5 rounded-full">{tag.trim()}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar */}
            <div>
              <div className="bg-card border border-border rounded-xl p-4 sm:p-6 sticky top-24 space-y-3 sm:space-y-4">
                {applyLink !== "#" ? (
                  <a
                    href={applyLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleApplyClick}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:opacity-90 transition-opacity"
                  >
                    <ExternalLink size={16} /> {isContract ? "Apply / Submit Proposal" : "Apply Now"}
                  </a>
                ) : (
                  <div className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-muted text-muted-foreground rounded-xl font-medium text-sm cursor-not-allowed">
                    Application link not available
                  </div>
                )}
                {isContract && torHref && (
                  <a
                    href={torHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 border border-orange-300 text-orange-700 bg-orange-50 rounded-xl font-medium text-sm hover:bg-orange-100 transition-colors"
                  >
                    <FileText size={16} /> View Terms of Reference
                  </a>
                )}
                {documents.filter((d) => fileUrl(d.url) !== torHref).map((d) => (
                  <a
                    key={d.id}
                    href={fileUrl(d.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 border border-border rounded-xl font-medium text-sm hover:bg-muted transition-colors"
                    title={d.filename}
                  >
                    <FileText size={16} /> <span className="truncate">{d.filename}</span>
                  </a>
                ))}
                <button
                  onClick={handleShare}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 border border-border rounded-xl font-medium text-sm hover:bg-muted transition-colors"
                >
                  <Share2 size={16} /> {isContract ? "Share Contract" : "Share Job"}
                </button>
                <Link
                  to={`/chat?jobId=${job.id}`}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 transition-colors"
                >
                  <FileCheck size={16} /> Check if my CV aligns
                </Link>

                {job.application_deadline && (
                  <div className="border-t border-border pt-3 mt-3">
                    <p className="text-xs text-muted-foreground mb-1">Application Deadline</p>
                    <p className="text-sm font-semibold text-orange-600">{formatDate(job.application_deadline)}</p>
                  </div>
                )}

                <div className="border-t border-border pt-3 mt-3 space-y-2 text-xs text-muted-foreground">
                  {job.company && <p><span className="font-medium text-foreground">{isContract ? "Organization:" : "Company:"}</span> {job.company}</p>}
                  {job.type && <p><span className="font-medium text-foreground">Type:</span> {job.type}</p>}
                  {isContract && job.duration && <p><span className="font-medium text-foreground">Duration:</span> {job.duration}</p>}
                  {isContract && job.budget && <p><span className="font-medium text-foreground">Budget / Fee:</span> {job.budget}</p>}
                  {job.location && <p><span className="font-medium text-foreground">Location:</span> {job.location}</p>}
                </div>
              </div>
            </div>
          </div>

          {similarJobs.length > 0 && (
            <div className="mt-8 sm:mt-12">
              <h2 className="font-heading text-lg sm:text-xl font-bold mb-4 sm:mb-6">Similar Jobs</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {similarJobs.map((j) => (
                  <JobCard key={j.id} job={j} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default JobDetails;
