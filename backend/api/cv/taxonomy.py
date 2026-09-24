"""
Curated skill/tool keyword taxonomy for the rule-based CV engine.

This is the only "knowledge" the matcher has — there is no ML model here.
It's used two ways:
  1. Scanned against a CV's text to find skills the candidate has.
  2. Scanned against a job's description/requirements/tags to find skills
     the role is asking for.
Extend this list over time as gaps are noticed; no redeploy of a model is
ever needed, just editing this dict.
"""

SKILLS_TAXONOMY: dict[str, list[str]] = {
    "programming": [
        "python", "java", "javascript", "typescript", "c++", "c#", "c",
        "go", "golang", "rust", "ruby", "php", "swift", "kotlin", "scala",
        "r", "matlab", "perl", "objective-c", "dart", "bash", "shell scripting",
        "sql", "html", "css", "sass", "less",
    ],
    "frameworks_libraries": [
        "react", "react.js", "angular", "vue", "vue.js", "next.js", "nuxt.js",
        "django", "flask", "fastapi", "express", "express.js", "spring",
        "spring boot", "laravel", "ruby on rails", "asp.net", ".net",
        "node.js", "jquery", "redux", "graphql", "rest api", "restful api",
        "tailwind css", "bootstrap", "material ui",
    ],
    "data_ml": [
        "pandas", "numpy", "scikit-learn", "tensorflow", "pytorch", "keras",
        "machine learning", "deep learning", "data analysis", "data science",
        "data visualization", "tableau", "power bi", "excel", "spss", "sas",
        "statistics", "nlp", "computer vision", "etl", "data engineering",
        "big data", "spark", "hadoop", "airflow",
    ],
    "databases": [
        "postgresql", "postgres", "mysql", "mongodb", "sqlite", "redis",
        "oracle", "sql server", "dynamodb", "cassandra", "elasticsearch",
        "firebase", "supabase", "mariadb",
    ],
    "cloud_devops": [
        "aws", "amazon web services", "azure", "gcp", "google cloud",
        "docker", "kubernetes", "terraform", "ansible", "jenkins",
        "ci/cd", "github actions", "gitlab ci", "linux", "unix",
        "nginx", "load balancing", "microservices", "serverless",
    ],
    "tools": [
        "git", "github", "gitlab", "bitbucket", "jira", "confluence",
        "figma", "adobe photoshop", "adobe illustrator", "adobe xd",
        "sketch", "invision", "canva", "postman", "vs code", "slack",
        "notion", "trello", "asana", "zendesk", "salesforce", "hubspot",
        "sap", "quickbooks", "google analytics", "google ads",
        "facebook ads", "mailchimp",
    ],
    "design": [
        "ui design", "ux design", "user research", "wireframing",
        "prototyping", "graphic design", "brand identity",
        "responsive design", "design systems", "typography",
    ],
    "marketing": [
        "seo", "sem", "content marketing", "content writing", "copywriting",
        "social media marketing", "email marketing", "digital marketing",
        "brand management", "market research", "campaign management",
        "growth marketing", "affiliate marketing", "public relations",
    ],
    "finance_accounting": [
        "financial modeling", "financial analysis", "budgeting",
        "forecasting", "bookkeeping", "accounts payable",
        "accounts receivable", "auditing", "taxation", "ifrs", "gaap",
        "financial reporting", "risk management", "investment analysis",
        "reconciliation", "payroll",
    ],
    "sales_business": [
        "sales", "business development", "account management",
        "customer relationship management", "crm", "negotiation",
        "lead generation", "cold calling", "client retention",
        "b2b sales", "b2c sales", "sales strategy",
    ],
    "hr_admin": [
        "recruitment", "talent acquisition", "onboarding",
        "employee relations", "performance management",
        "compensation and benefits", "hr policies", "training and development",
        "administrative support", "office management", "scheduling",
        "data entry",
    ],
    "project_management": [
        "project management", "agile", "scrum", "kanban", "waterfall",
        "pmp", "stakeholder management", "risk assessment",
        "resource planning", "product management", "roadmap planning",
        "sprint planning",
    ],
    "customer_support": [
        "customer service", "customer support", "technical support",
        "help desk", "ticketing systems", "live chat support",
        "call center", "conflict resolution",
    ],
    "soft_skills": [
        "communication", "leadership", "teamwork", "problem solving",
        "critical thinking", "time management", "adaptability",
        "attention to detail", "collaboration", "creativity",
        "analytical skills", "presentation skills", "mentoring",
        "decision making", "multitasking", "interpersonal skills",
    ],
    "languages_certs": [
        "english", "french", "swahili", "arabic", "mandarin", "spanish",
        "google certified", "aws certified", "pmp certified",
        "cpa", "acca", "cfa", "six sigma", "itil",
    ],
}

# Flat lookup: lowercase skill -> category, for O(1) membership checks.
ALL_SKILLS: dict[str, str] = {
    skill: category
    for category, skills in SKILLS_TAXONOMY.items()
    for skill in skills
}

# Common English stopwords + noise words to exclude when mining candidate
# proper-noun tools from free text (job descriptions/CVs) that aren't in
# the curated list above.
PROPER_NOUN_STOPWORDS = {
    "the", "and", "for", "with", "this", "that", "from", "your", "our",
    "you", "are", "will", "have", "has", "who", "what", "when", "where",
    "kenya", "nairobi", "mombasa", "kisumu", "eldoret", "africa", "remote",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
    "sunday", "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
    "ltd", "inc", "llc", "plc", "corp", "company", "job", "jobs", "role",
    "team", "work", "annex", "careers",
    # ALL-CAPS emphasis words in job ads ("NOT required", "MUST have")
    "not", "must", "all", "any", "new", "now", "can", "may", "etc", "tech",
    "stack", "apply", "note", "only", "full", "time", "senior", "junior",
}
