import { Link } from "react-router-dom";
import { MapPin, Clock, CalendarClock, Building2, DollarSign, FileText, Hourglass } from "lucide-react";
import { fileUrl, type Job } from "@/lib/jobStore";

function formatDeadline(deadline: string): string {
  if (!deadline) return "";
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-KE", { month: "short", day: "numeric", year: "numeric" });
}

function isExpiringSoon(deadline: string): boolean {
  if (!deadline) return false;
  const d = new Date(deadline);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000;
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const JobCard = ({ job }: { job: Job }) => {
  const deadlineStr = formatDeadline(job.application_deadline);
  const expiringSoon = isExpiringSoon(job.application_deadline);
  const isRemote = job.remote || job.type?.toLowerCase().includes("remote") ||
    job.location?.toLowerCase().includes("remote");
  const postedAgo = timeAgo(job.posted);
  const initials = job.company
    ? job.company.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")
    : "";
  const jobType = job.type?.toLowerCase().trim() || "";
  const isContract = job.kind === "contract";
  const poster = job.attachments?.find((a) => a.kind === "image");

  return (
    <Link
      to={`/jobs/${job.id}`}
      className="bg-card border rounded-xl p-5 hover-lift group flex flex-col h-full cursor-pointer transition-shadow block"
    >
      {/* Header: logo + badges */}
      <div className="flex items-start justify-between mb-4 gap-2">
        {poster ? (
          <img src={fileUrl(poster.url)} alt="" loading="lazy" className="w-11 h-11 rounded-xl object-cover border border-border shrink-0" />
        ) : (
          <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary font-heading font-bold flex items-center justify-center text-sm shrink-0">
            {initials || <Building2 size={18} />}
          </div>
        )}
        <div className="flex flex-wrap gap-1 justify-end">
          {isRemote && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              Remote
            </span>
          )}
          {jobType && jobType.includes("full") && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
              Full-time
            </span>
          )}
          {(isContract || jobType.includes("contract")) && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 inline-flex items-center gap-1">
              {isContract && <FileText size={9} />}{isContract ? (jobType.includes("consult") ? "Consultancy" : "Contract") : "Contract"}
            </span>
          )}
          {jobType && jobType.includes("part") && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
              Part-time
            </span>
          )}
          {jobType && jobType.includes("internship") && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300">
              Internship
            </span>
          )}
          {jobType && !isRemote && !isContract && !jobType.includes("full") && !jobType.includes("contract") && !jobType.includes("part") && !jobType.includes("internship") && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
              {job.type}
            </span>
          )}
        </div>
      </div>

      {/* Job title */}
      <h3 className="font-heading font-semibold text-sm sm:text-base mb-1 group-hover:text-primary transition-colors line-clamp-2 leading-snug">
        {job.title}
      </h3>

      {/* Company */}
      <div className="flex items-center gap-1.5 mb-3 min-w-0">
        <Building2 size={12} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-muted-foreground truncate">
          {job.company || "Company not listed"}
        </span>
      </div>

      {/* Location + Posted */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mb-3">
        {job.location && (
          <span className="flex items-center gap-1">
            <MapPin size={11} className="shrink-0" />
            <span className="truncate max-w-[120px]">{job.location}</span>
          </span>
        )}
        {postedAgo && (
          <span className="flex items-center gap-1">
            <Clock size={11} className="shrink-0" /> {postedAgo}
          </span>
        )}
        {isContract && job.duration && (
          <span className="flex items-center gap-1">
            <Hourglass size={11} className="shrink-0" /> {job.duration}
          </span>
        )}
      </div>

      {/* Deadline warning */}
      {deadlineStr && (
        <div className={`flex items-center gap-1 text-xs mb-3 ${expiringSoon ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
          <CalendarClock size={11} />
          <span>Closes {deadlineStr}</span>
          {expiringSoon && (
            <span className="ml-1 bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide">
              Closing soon
            </span>
          )}
        </div>
      )}

      {/* Footer: salary + more */}
      <div className="flex items-center justify-between mt-auto pt-3 border-t border-border gap-2">
        {(isContract ? job.budget || job.salary : job.salary) ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-foreground">
            <DollarSign size={11} className="text-primary shrink-0" />
            <span className="truncate">{isContract ? job.budget || job.salary : job.salary}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground italic">{isContract ? "Fee not listed" : "Salary not listed"}</span>
        )}
        <span className="text-xs font-semibold text-white bg-primary px-3 py-1 rounded-md whitespace-nowrap">
          More
        </span>
      </div>
    </Link>
  );
};

export default JobCard;
