import { Link } from "react-router-dom";
import Layout from "@/components/Layout";

const steps = [
  {
    step: "01",
    title: "Search",
    description: "Browse thousands of jobs aggregated from multiple platforms. Filter by location, category, salary, and job type.",
  },
  {
    step: "02",
    title: "Check Your Fit",
    description: "Found a role? Click \"Check if my CV aligns\" our Annex Agent will analyze your resume against the job requirements.",
  },
  {
    step: "03",
    title: "Apply",
    description: "Use our Agent feedback to strengthen your CV, then apply directly.",
  },
];

const sources = [
  "LinkedIn", "BrighterMonday", "Indeed", "Fuzu", "MyJobMag", "RemoteOK",
  "WeWorkRemotely", "Remotive", "Wellfound", "Talent.com", "AI Jobs",
  "CareerPoint Kenya", "Pigiame", "Adzuna", "JobWebKenya", "KenyaJob",
  "Corporate Staffing", "Summit Recruitment", "UN Careers", "WHO Careers",
  "Company Career Pages", "WorkAtAStartup (YC)",
];

const whyReasons = [
  { title: "All-in-One", text: "Every job board in one place, no need to visit 20+ sites separately." },
  { title: "25+ Sources", text: "We pull from local, global, and remote job boards plus company career pages." },
  { title: "Updated Daily", text: "Our scrapers run every day to bring you the freshest opportunities." },
  { title: "Smart Filters", text: "Advanced filters for location, salary, job type, remote, and more." },
  { title: "Global + Local", text: "Remote & on-site jobs from Kenya, East Africa, and worldwide." },
  { title: "Annex Agent", text: "Our Agent assistant reviews your CV against any job, upload your resume and get a match score, skills gap analysis, and improvements." },
];

const About = () => {
  return (
    <Layout>
      <div className="pt-28 md:pt-36 lg:pt-20">
        {/* Hero */}
        <div className="bg-primary text-primary-foreground">
          <div className="container py-16 sm:py-20 px-4 text-center">
            <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold mb-4">
              Your Career Starts Here
            </h1>
            <p className="text-primary-foreground/80 max-w-2xl mx-auto text-base sm:text-lg">
              Annex Careers is an aggregation platform. We collect listings from 25+ sources including local boards, global remote sites, company career pages, and NGOs; all in one interface.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                to="/jobs"
                className="px-8 py-3 bg-background text-foreground rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity"
              >
                Browse Jobs
              </Link>
              <Link
                to="/categories"
                className="px-8 py-3 border-2 border-primary-foreground/30 text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary-foreground/10 transition-colors"
              >
                View Categories
              </Link>
            </div>
          </div>
        </div>

        {/* How It Works */}
        <div className="bg-muted">
          <div className="container py-16 sm:py-20 px-4">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold mb-4 text-center">How It Works</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {steps.map((step) => (
                <div
                  key={step.title}
                  className="bg-card border border-border rounded-2xl p-8 text-center shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="w-14 h-14 rounded-full bg-primary text-primary-foreground font-heading font-bold text-xl flex items-center justify-center mx-auto mb-5">
                    {step.step}
                  </div>
                  <h3 className="font-heading font-bold text-xl mb-3">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Why Annex Careers */}
        <div className="container py-16 sm:py-20 px-4">
          <h2 className="font-heading text-2xl sm:text-3xl font-bold mb-4 text-center">Why Annex Careers</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {whyReasons.map((reason) => (
              <div
                key={reason.title}
                className="bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-colors"
              >
                <h3 className="font-heading font-semibold text-base mb-2">{reason.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{reason.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Sources */}
        <div className="bg-muted">
          <div className="container py-16 sm:py-20 px-4">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold mb-4 text-center">Our Data Sources</h2>
            <p className="text-sm text-muted-foreground text-center mb-10 max-w-lg mx-auto">
              Jobs aggregated from 25+ platforms, updated every day
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {sources.map((source) => (
                <div
                  key={source}
                  className="bg-card border border-border rounded-xl p-4 text-center text-sm font-medium hover:border-primary/30 transition-colors"
                >
                  {source}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="container py-16 sm:py-20 px-4 text-center">
          <h2 className="font-heading text-2xl sm:text-3xl font-bold mb-3">Ready to Get Started?</h2>
          <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
            Thousands of jobs from Kenya and worldwide are waiting for you. Start browsing now.
          </p>
          <Link
            to="/jobs"
            className="inline-block px-10 py-3.5 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Start Browsing Jobs
          </Link>
        </div>
      </div>
    </Layout>
  );
};

export default About;
