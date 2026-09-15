import { useParams, Link } from "react-router-dom";
import { ArrowLeft, MapPin, Briefcase, Clock, ExternalLink, Share2, CalendarClock, Building2, Loader2, FileCheck } from "lucide-react";
import Layout from "@/components/Layout";
import JobCard from "@/components/JobCard";
import { useJobs } from "@/lib/jobStore";
import { toast } from "sonner";

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-KE", { month: "long", day: "numeric", year: "numeric" });
}

const JobDetails = () => {
  const { id } = useParams();
  const { jobs: allJobs, loading } = useJobs();
  const job = allJobs.find((j) => j.id === id);

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

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied to clipboard!");
  };

  const applyLink = job.apply_url || job.url || "#";
  const hasDescription = job.description && job.description.trim().length > 0;
  const hasRequirements = job.requirements && job.requirements.length > 0;

  return (
    <Layout>
      <div className="pt-28 md:pt-36 lg:pt-20">
        <div className="container py-6 sm:py-8 px-4">
          <Link to="/jobs" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 mt-2 block">
            <ArrowLeft size={16} /> Back to jobs
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
                    <p className="text-xs text-muted-foreground">Hiring company</p>
                  </div>
                </div>

                <h1 className="font-heading text-lg sm:text-2xl font-bold mb-4">{job.title}</h1>

                <div className="flex flex-wrap gap-3 sm:gap-4 text-sm text-muted-foreground mb-4 sm:mb-6">
                  {job.location && <span className="flex items-center gap-1"><MapPin size={14} /> {job.location}</span>}
                  {job.type && <span className="flex items-center gap-1"><Briefcase size={14} /> {job.type}</span>}
                  {job.posted && <span className="flex items-center gap-1"><Clock size={14} /> Posted {formatDate(job.posted)}</span>}
                  {job.application_deadline && (
                    <span className="flex items-center gap-1 text-orange-600">
                      <CalendarClock size={14} /> Deadline: {formatDate(job.application_deadline)}
                    </span>
                  )}
                </div>

                {job.salary && <p className="font-heading text-lg sm:text-xl font-bold text-primary mb-4 sm:mb-6">{job.salary}</p>}

                <h2 className="font-heading font-semibold text-base sm:text-lg mb-3">Description</h2>
                {hasDescription ? (
                  <div className="text-sm text-muted-foreground leading-relaxed mb-6 whitespace-pre-line break-words overflow-hidden">
                    {job.description}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground mb-6 bg-muted/50 rounded-lg p-4">
                    <p className="mb-2">No description available for this position.</p>
                    {applyLink !== "#" && (
                      <a href={applyLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium inline-flex items-center gap-1">
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
                        <a href={applyLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium inline-flex items-center gap-1">
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
                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:opacity-90 transition-opacity"
                  >
                    <ExternalLink size={16} /> Apply Now
                  </a>
                ) : (
                  <div className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-muted text-muted-foreground rounded-xl font-medium text-sm cursor-not-allowed">
                    Application link not available
                  </div>
                )}
                <button
                  onClick={handleShare}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 border border-border rounded-xl font-medium text-sm hover:bg-muted transition-colors"
                >
                  <Share2 size={16} /> Share Job
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
                  {job.company && <p><span className="font-medium text-foreground">Company:</span> {job.company}</p>}
                  {job.type && <p><span className="font-medium text-foreground">Type:</span> {job.type}</p>}
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
