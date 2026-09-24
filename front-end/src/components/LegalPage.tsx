import { ReactNode } from "react";
import Layout from "@/components/Layout";

export const CONTACT_EMAIL = "info@annex-technologies.com";

export interface LegalSection {
  heading: string;
  body: ReactNode;
}

/** Shared shell for Privacy Policy and Terms: hero, "last updated" line, numbered sections. */
const LegalPage = ({ title, intro, updated, sections }: { title: string; intro: ReactNode; updated: string; sections: LegalSection[] }) => (
  <Layout>
    <div className="pt-28 md:pt-36 lg:pt-20">
      <div className="bg-primary text-primary-foreground">
        <div className="container py-14 sm:py-16 px-4 text-center">
          <h1 className="font-heading text-3xl sm:text-4xl font-bold mb-3">{title}</h1>
          <p className="text-primary-foreground/80 text-sm">Last updated {updated}</p>
        </div>
      </div>

      <article className="container max-w-3xl py-12 sm:py-16 px-4 text-sm sm:text-base leading-relaxed text-foreground/90">
        <div className="mb-10 text-muted-foreground">{intro}</div>
        {sections.map((section, i) => (
          <section key={section.heading} className="mb-10">
            <h2 className="font-heading text-lg sm:text-xl font-bold mb-3 text-foreground">
              {i + 1}. {section.heading}
            </h2>
            <div className="space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-primary [&_a]:underline">
              {section.body}
            </div>
          </section>
        ))}
      </article>
    </div>
  </Layout>
);

export default LegalPage;
