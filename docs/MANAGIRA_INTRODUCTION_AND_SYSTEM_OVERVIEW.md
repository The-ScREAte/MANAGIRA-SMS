# Managira Documentation

## 1. Introduction

### 1.1 Purpose of This Document
This document introduces Managira and presents a complete system-level overview of how the platform is organized, how it behaves at runtime, and how core business capabilities are delivered across schools, hubs, guardians, and administrators. It is intended to support technical onboarding, stakeholder alignment, implementation planning, and operational decision-making.

The goal is not only to describe features, but to explain the architecture, boundaries, workflows, and integrations that make Managira function as a production school management platform.

### 1.2 About Managira
Managira is an all-in-one school management system designed to centralize school operations in a single platform. It provides a unified environment for managing enrollment, student records, class and academic workflows, school communications, billing and payment operations, reporting, and public-facing school information.

At its core, Managira is built to replace fragmented school tooling with a structured, role-aware platform where operational data, academic records, and administrative actions can be executed consistently and securely.

### 1.3 Product Vision and Operating Philosophy
Managira is built around five practical principles:

1. Unified operations: core academic and administrative activities should run on one system of record.
2. Multi-tenant flexibility: schools and hub networks should share infrastructure while preserving data boundaries and brand identity.
3. Role-driven workflows: each actor should see only the actions and data relevant to their permissions.
4. Production reliability: mission-critical workflows such as billing, communication, scheduling, and reporting must execute predictably.
5. Extensibility: the platform should accommodate additional school processes, modules, and integrations without major redesign.

### 1.4 Target Users and Stakeholders
Managira serves multiple categories of users:

- School administrators who manage admissions, student lifecycle data, records, documentation, and institution-level settings.
- Teachers and academic staff who require streamlined access to classes, assessments, and academic outcomes.
- Finance and operations staff responsible for fee management, payment reconciliation, and billing continuity.
- Guardians who need secure visibility into their children, records, and school-facing interactions.
- Hub operators who coordinate multiple schools under shared governance and branded structures.

### 1.5 Problem Domain and Business Value
Schools commonly face operational fragmentation: admissions in one tool, academic records in another, payment tracking elsewhere, and communication scattered across informal channels. This increases errors, delays reporting, and creates weak auditability.

Managira addresses this by providing:

- A consolidated data and workflow backbone.
- Controlled access by role and feature permissions.
- Structured integrations for payments, file handling, and messaging.
- Automated background processes for scheduled tasks and recurring operations.
- Institution and hub-level organization to support growth across multiple schools.

### 1.6 Scope of Platform Capabilities
From the current codebase and runtime structure, Managira includes capabilities across:

- Account and authentication workflows.
- Administrative operations.
- Enrollment and student progression.
- Academic record production (reports, transcripts, print outputs).
- Guardian-facing access.
- Legal and public-facing pages.
- Document handling and file workflows.
- Hub-specific multi-organization management.
- Chatbot/API endpoints for assisted interactions.
- Billing and payment scheduling, including Paystack integration and payout automation support.

### 1.7 Technical Direction
Managira uses a server-rendered web application model with modular routing, controller-based request handling, middleware-driven cross-cutting concerns, PostgreSQL persistence, and integrations for cloud storage and payment infrastructure. This architecture is intentionally pragmatic: fast to iterate, straightforward to operate, and suitable for institutions requiring predictable business workflows over novelty.

---

## 2. System Overview

### 2.1 Architectural Style
Managira follows a modular monolith architecture built on Node.js and Express. The system is composed of feature-oriented route and controller modules that share common middleware, database access, and integration services.

This approach provides:

- Clear domain segmentation without the overhead of distributed microservices.
- Lower operational complexity for school-focused deployment environments.
- Easier traceability from route to business logic to persistence.

### 2.2 High-Level Technology Stack
Primary platform technologies include:

- Runtime and web framework: Node.js with Express.
- Templating and server-side rendering: EJS with layout support.
- Database: PostgreSQL.
- Authentication: Passport.js with session-based identity.
- Session persistence: PostgreSQL-backed session store.
- File and media storage: AWS S3 integration.
- Payment infrastructure: Paystack integration and related billing jobs.
- Messaging: email pipeline support through nodemailer and scheduled processing.
- Asset pipeline and frontend build support: Vite and TypeScript tooling.
- Background job execution: scheduler and cron-based workers.

### 2.3 Runtime Application Structure
At startup, the system initializes core infrastructure and middleware in a deliberate order:

1. Environment and configuration loading.
2. Database connection and runtime dependency setup.
3. Authentication strategies for standard and hub-specific user contexts.
4. Background jobs and schedulers (for billing, keep-alive, and automation tasks).
5. Cross-cutting middleware (compression, request monitoring, context injectors, cache handling, term/theme/feature resolution).
6. Route registration per domain.
7. Error and fallback handlers.
8. Port startup with development fallback retries if the preferred port is occupied.

This sequence ensures the platform is operationally ready before handling end-user traffic.

### 2.4 Domain Module Organization
The codebase is segmented by business domain with dedicated controllers and route definitions. Core modules include:

- Account management.
- Administration.
- Common shared school workflows.
- Enrollment.
- Promotion and progression.
- Transcripts and printing.
- Guardian portal.
- Hub management.
- Legal/public pages.
- Stats and reporting endpoints.
- Documents and uploads.
- Chatbot API integration.

This structure supports predictable ownership and allows each domain to evolve without destabilizing unrelated workflows.

### 2.5 Multi-Tenancy and Organization Context
Managira is designed for multi-organization usage under shared infrastructure, with support for:

- Root domain behavior for platform landing and shared pages.
- School-level subdomains for organization-specific experiences.
- Optional hub-linked subdomain structure for organizations associated with a parent hub.

Request processing resolves organization context from hostname patterns, retrieves school and hub metadata, and attaches this context to the request lifecycle. This enables tenant-aware rendering, access, and branding without requiring separate deployments per school.

A runtime subdomain cache is used to reduce repeated lookup overhead and improve response consistency on high-traffic paths.

### 2.6 Identity, Authentication, and Authorization Model
Authentication and access control are layered:

- Session-backed identity handling through Passport strategies.
- Domain-specific auth middleware for general users, guardians, and hubs.
- Permission and role middleware to enforce action-level and module-level access.
- Feature gating middleware to control organization-level entitlements.

This design enables both coarse-grained role protection and fine-grained feature governance, which is essential for institution-specific subscription or policy differences.

### 2.7 Data Management and Persistence
PostgreSQL is the primary system of record for application data. Persistent concerns include:

- User and organization records.
- Academic entities and student lifecycle data.
- Billing/payment and scheduler-related state.
- Session storage for authenticated user continuity.
- Hub relationships and membership metadata.

The repository includes dedicated SQL migration and maintenance scripts for payment and schema evolution tasks, supporting controlled rollout of database changes.

### 2.8 File and Document Handling
Managira supports document workflows and media/file assets through:

- Upload pathways integrated in middleware and route handlers.
- AWS S3-based object storage support for persistent file hosting.
- Public and protected file serving patterns based on route context.

This enables schools to manage documents and related assets while reducing reliance on local disk-only persistence.

### 2.9 Payments, Billing, and Financial Automation
Payment and billing capabilities are integrated at both request and background-job layers:

- Paystack integration for school fee collection workflows.
- Billing schedulers and recurring processing jobs.
- Payout-related scheduling components.
- Supporting migration scripts to maintain payment data integrity as capabilities evolve.

Operationally, these components are separated from interactive request paths where needed, improving resilience for time-based billing activities.

### 2.10 Background Processing and Scheduled Tasks
The platform executes recurring operational tasks using scheduler and cron mechanisms. Typical automated workloads include:

- Periodic keep-alive operations.
- Billing and recurring payment cycles.
- Scheduled hold application logic.
- Other asynchronous maintenance jobs.

This model allows business-critical processes to continue independently of active user sessions.

### 2.11 Web Delivery, Rendering, and Performance Controls
Managira serves dynamic HTML views and static assets with practical optimization controls:

- EJS rendering with shared layout templates for consistency.
- Gzip compression for reduced payload sizes.
- Static asset caching controls.
- Request latency monitoring middleware.
- Cache preloading and selective cache headers where applicable.

Together, these controls improve perceived speed and support stable operation under normal institutional workloads.

### 2.12 Public-Facing and SEO Surface
The system includes public routes and SEO-aware behavior for discoverability and branded identity:

- Platform landing and directory pages.
- School-facing public dashboard routing.
- Dynamic sitemap generation for school pages.
- Domain/subdomain-aware request routing.

This allows Managira to function as both an internal operations platform and a public-facing institutional surface.

### 2.13 Error Handling and Operational Safety
Operational safeguards in the application include:

- Not-found and global error handlers.
- Startup database connectivity checks.
- Permission schema readiness initialization at boot.
- Development-mode port fallback to prevent local startup failure.
- Health-check endpoint exposure for service monitoring.

These controls improve debuggability and reduce outage risks during both development and production operations.

### 2.14 Deployment Model
Managira is deployed as a Node.js web service with environment-driven configuration for:

- Database connectivity.
- Session secrets and cookie behavior.
- Payment provider credentials.
- Cloud storage credentials.
- Environment-specific base URLs and runtime toggles.

The deployment model supports standard cloud hosting and can scale vertically for medium workloads while retaining a clear path to future horizontal optimization if required.

### 2.15 Summary of System Posture
Managira presents a mature, operationally grounded school management architecture with:

- Strong domain modularity.
- Practical multi-tenant context resolution.
- Integrated payments and background automation.
- Role- and feature-aware access control.
- Production-focused middleware and reliability patterns.

In practical terms, the platform is positioned to serve schools that require one cohesive system for enrollment, academics, finance, reporting, and stakeholder access, while maintaining enough architectural structure to support ongoing growth.

---

## 5. Roles and Permissions (Managers, Supervisors, Teachers)

### 5.1 Purpose and Scope
This section defines the role and permission model for operational users, focused strictly on:

- Managers
- Supervisors
- Teachers
- Main Teachers (a teacher with class-level lead responsibilities)

The purpose is to make day-to-day access behavior explicit: what each role can do, what each role cannot do, what each role can view, and how file/document access is controlled.

### 5.2 How Access Is Enforced
Managira uses layered access control so permissions are not decided by one rule alone. Access is evaluated through:

1. Session identity: user must be authenticated to the organization.
2. Role context: role influences defaults and UI visibility.
3. Permission checks: many routes require specific permission keys.
4. Feature checks and context checks: some screens add class-specific and workflow-specific constraints.
5. Ownership and assignment checks: especially for files, edit and visibility are based on creator, direct assignment, or class assignment.

This layered model prevents overexposure of student and operational data while allowing delegated workflows.

### 5.3 Permission Catalog (Operational)
The operational permission set used across these roles includes:

- manage_employees
- manage_students
- manage_guardians
- manage_assessments
- mark_attendance
- manage_reports
- manage_records
- manage_promotions
- approve_promotions
- approve_admissions
- publish_events_announcements
- manage_school_year_terms
- manage_classes_subjects
- generate_transcripts
- manage_billing
- manage_settings

Each permission gates one or more workflows and routes. Role defaults define what is available immediately, and additional permissions can be assigned where your organization policy allows delegation.

### 5.4 Default Role Permission Baselines

#### Manager (Default Baseline)
Managers are configured as full operational owners for school-level management and receive the full operational permission set by default. In practical terms, a manager can:

- Manage staff and role assignments.
- Manage students and guardians.
- Manage assessments, attendance, and records.
- Manage admissions and promotions.
- Manage classes, subjects, school years, terms, announcements, transcripts, billing, and organization settings.

Because managers are operational owners, they are treated as high-trust users for cross-module workflows.

#### Supervisor (Default Baseline)
Supervisors receive broad academic and student-operation permissions by default, including:

- Student and guardian management.
- Assessments and attendance management.
- Reports/printing workflows.
- Admissions approval.
- Events and announcements publishing.
- Class and subject management.
- Transcript generation.
- Promotion management.

By default, supervisors do not automatically receive full employee administration, billing, or organization settings authority unless explicitly delegated by policy.

#### Teacher (Default Baseline)
Teachers receive a focused instructional baseline by default:

- manage_assessments
- mark_attendance

This supports teaching responsibilities while limiting non-instructional administrative exposure by default.

#### Main Teacher (Contextual Teaching Lead)
Main Teacher is not a separate account type; it is a class-level designation assigned to a teacher. A Main Teacher keeps teacher permissions and gains class-specific authority in designated workflows.

Most notably, attendance collection workflow access is restricted so only the Main Teacher for that class can proceed (except where higher-level operational roles are allowed by route policy).

### 5.5 Role-by-Role Responsibilities and Boundaries

#### Manager: Responsibilities and Boundaries
Managers are responsible for institutional control of operational setup and data stewardship.

Typical responsibilities:

- Staff lifecycle and assignment governance.
- Academic structure and year/term control.
- Billing and subscription-sensitive workflows.
- Organization-level settings and branding control.
- Final control of file governance and school records.

Typical boundaries:

- Managers should still follow least-privilege governance when delegating permissions.
- Access should be exercised in alignment with school policy and audit expectations.

#### Supervisor: Responsibilities and Boundaries
Supervisors are operational-academic coordinators. They usually drive class-level and student-level administration without taking full platform ownership.

Typical responsibilities:

- Student admission handling and ongoing records support.
- Monitoring assessment and attendance completion.
- Managing class/subject academic structures where delegated.
- Producing academic reports and transcripts where permitted.

Typical boundaries:

- No automatic ownership of billing and settings domains.
- File creation/deletion and permission administration depend on manage_records delegation.

#### Teacher: Responsibilities and Boundaries
Teachers are instructional users focused on classroom execution.

Typical responsibilities:

- Entering and managing assessment outcomes.
- Attendance actions in workflows available to their role and class context.
- Accessing assigned class-related resources and shared instructional files.

Typical boundaries:

- No default control over organization-wide records administration.
- No default control over billing/settings domains.
- Access to class resources is constrained by assignment and workflow rules.

#### Main Teacher: Responsibilities and Boundaries
Main Teachers are class owners for specific classroom operations.

Typical responsibilities:

- Lead classroom attendance process for their designated class.
- Serve as first-line class coordinator for teacher-facing class workflows.

Typical boundaries:

- Main Teacher authority is contextual (class-specific), not global.
- Being a Main Teacher does not automatically grant full school administrative powers.

### 5.6 Visibility Rules: Who Can See What

#### Class Dashboard and Class-Scoped Access
- Managers and Supervisors can generally open class dashboards as part of operational oversight.
- Teachers are constrained to classes where they are assigned.
- If a teacher is not mapped to a class, class-level dashboard access for that class is denied.

#### Attendance Collection Access
- Managers can access attendance collection workflows.
- Teachers can access attendance collection only when they are the Main Teacher for the selected class.
- If no Main Teacher is assigned for a class, attendance collection is blocked for teacher flow until assignment is made.

#### Student/Guardian/Academic Data Exposure
- Managers: broad visibility by virtue of full operational permissions.
- Supervisors: visibility across delegated student-academic workflows.
- Teachers: visibility primarily limited to instructional and assigned-class contexts unless additional permissions are granted.

### 5.7 File and Document Access Model (Who Has Access to Files)
Managira file access is controlled by role permissions and explicit assignment logic. Access decisions combine:

- Permission-based authority (especially manage_records).
- Document creator identity.
- Direct per-user file permission (view, comment, edit).
- Class-based assignment permission (view, comment, edit).
- Class membership for non-managerial users.

#### File Capabilities by Role Context

##### Manager
- Can create files when manage_records is available (default for manager baseline).
- Can edit and delete files as part of records authority.
- Can update file sharing permissions (user-level and class-level).
- Can access class data used for spreadsheet population in file workflows.

##### Supervisor
- If manage_records is granted: can operate like records managers for file creation, deletion, permission updates, and class data access.
- If manage_records is not granted: cannot create/delete files or administer file permissions; visibility is limited to assigned/authorized files.

##### Teacher
- By default, teachers do not have manage_records, so file creation/deletion and permission administration are not available.
- Teachers can still view files when one of the following is true:
	- They created the file.
	- They were granted direct file permission.
	- The file was assigned to a class where they are an assigned class employee.
- Edit access for teachers requires explicit edit permission (directly or through class assignment), unless they are the creator.

##### Main Teacher
- Main Teacher follows teacher file rules unless additional permissions are granted.
- Main Teacher status alone does not automatically grant full file administration.

### 5.8 Permission-to-Role Matrix (Default)

| Permission Key | Manager | Supervisor | Teacher | Main Teacher |
| --- | --- | --- | --- | --- |
| manage_employees | Yes | No (unless assigned) | No | No |
| manage_students | Yes | Yes | No (unless assigned) | No (unless assigned) |
| manage_guardians | Yes | Yes | No (unless assigned) | No (unless assigned) |
| manage_assessments | Yes | Yes | Yes | Yes |
| mark_attendance | Yes | Yes | Yes | Yes |
| manage_reports | Yes | Yes | No (unless assigned) | No (unless assigned) |
| manage_records | Yes | No (unless assigned) | No (unless assigned) | No (unless assigned) |
| manage_promotions | Yes | Yes | No (unless assigned) | No (unless assigned) |
| approve_promotions | Yes | No (unless assigned) | No (unless assigned) | No (unless assigned) |
| approve_admissions | Yes | Yes | No (unless assigned) | No (unless assigned) |
| publish_events_announcements | Yes | Yes | No (unless assigned) | No (unless assigned) |
| manage_school_year_terms | Yes | No (unless assigned) | No (unless assigned) | No (unless assigned) |
| manage_classes_subjects | Yes | Yes | No (unless assigned) | No (unless assigned) |
| generate_transcripts | Yes | Yes | No (unless assigned) | No (unless assigned) |
| manage_billing | Yes | No (unless assigned) | No | No |
| manage_settings | Yes | No (unless assigned) | No | No |

Notes:

- Main Teacher uses the Teacher permission baseline; its additional strength is class-context authority, not a separate permission bundle.
- Any No (unless assigned) entry can become allowed if your organization delegates that permission.

### 5.9 Practical Governance Guidance
For secure and practical operation, use the following governance pattern:

1. Keep Managers limited to trusted operational owners.
2. Use Supervisors for broad academic operations and admissions/reporting continuity.
3. Keep Teacher access focused on instructional workflows unless a specific operational need exists.
4. Assign Main Teacher explicitly per class and review assignments each term.
5. For files, grant edit permission intentionally and avoid broad edit assignment when view/comment is enough.
6. Review delegated permissions periodically to maintain least privilege.

### 5.10 User-Facing Access Outcomes
From a user perspective, this means:

- Managers experience full operational coverage across modules.
- Supervisors experience broad academic and student operations with controlled administrative limits.
- Teachers experience focused classroom workflows and assigned-resource visibility.
- Main Teachers experience teacher workflows plus lead-class attendance authority.

This structure keeps responsibilities clear, protects sensitive school data, and allows schools to scale operations without losing control of who can do what.

---

## 6. Setting Up Organization

### 6.1 Access Requirements
To set up an organization in Managira, the user must:

- Be registered on Managira.
- Have access to the organization account.

Only authenticated users with valid access can complete the full setup workflow.

### 6.2 Welcome Page and Setup Guidance
On first login, Managira displays a welcome page with:

- Useful security information for protecting school data.
- Practical instructions for completing the initial setup.

This onboarding page is designed to help schools move from account access to full operational readiness in a guided sequence.

### 6.3 Core Setup Sequence
Organization setup begins with defining the school structure used throughout the platform.

1. Set up school years and terms.
2. Create classes using the naming structure that fits your school model.
3. Create subjects using the same flexible structure as classes.

Classes and subjects become core academic references used across workflows unless changed later.

### 6.4 Editing Academic Structure
If class or subject structures change over time, Managira allows updates without rebuilding the entire system configuration.

Schools can edit classes and subjects so naming and organization continue to match real institutional operations.

### 6.5 Graduation Year Configuration
Schools can configure graduation school years to assign students to their expected graduation year.

This supports long-term academic planning, student tracking, and progression visibility.

### 6.6 Activate Current Academic Context
After setup, the school selects:

- The active current school year.
- The active current term.

Activating these values enables dashboard context and prepares the platform for live school activity.

### 6.7 Enrollment Activation
Once classes are created, enrollment is used to assign students into those classes so class rosters and student participation become active.

This transitions the organization from structural setup into active academic operation.

### 6.8 Employee Onboarding and Role Assignment
After enrollment is active, teachers can be invited through Employee Management.

Schools can then assign:

- Classes.
- Roles.
- Relevant operational responsibilities.

This step ensures staff access aligns with academic and administrative duties.

### 6.9 School Website Setup
Organization setup also includes school website configuration.

This allows users and the general public to view school activities based on updates published by the school. For detailed guidance, see the School Website section.

### 6.10 Outcome of Setup Completion
When these steps are completed, the organization is ready for full operational use in Managira, including:

- Active dashboard workflows.
- Student and class operations.
- Teacher participation.
- Public-facing communication through the school website.

## 7. School Website

### 7.1 Purpose and Strategic Value
The Managira School Website provides each school with a professionally managed public presence where parents, guardians, and the wider public can stay informed about the school.

This website layer serves two major goals:

1. Public communication: helping the school publish timely and trusted updates.
2. Institutional visibility: helping the school present its identity, achievements, and opportunities in a structured digital format.

By combining content management, school branding, and public-facing information pages in one platform, Managira removes the traditional need for schools to hire separate web development teams for routine website updates.

### 7.2 Public Audience and Communication Outcomes
The school website is designed for multiple audiences:

- Parents and guardians who need updates on school information and opportunities.
- Prospective families evaluating the school before admission.
- Community members and stakeholders who want visibility into school programs and events.
- The general public seeking reliable information about the school.

The outcome is a single, always-current public information source that reduces communication gaps and strengthens trust.

### 7.3 Discoverability and Search Visibility
Managira supports discoverability through a public web structure that includes school-facing pages and search-friendly delivery patterns.

In practical terms, this improves a school's ability to be found for relevant searches tied to its name, identity, programs, and public activities. While search engines determine ranking through their own algorithms, Managira is designed to strengthen visibility readiness by keeping school content structured, current, and indexable.

### 7.4 What Schools Can Publish
Schools can present a rich public experience without custom coding. Typical website content includes:

- Hero and slideshow images for first impressions.
- Image galleries that highlight school life, facilities, and culture.
- About sections explaining who the school is, its values, mission, and identity.
- Text blocks for school stories, highlights, and announcements.
- Events and announcements for current school-year communication.
- Contact and profile details such as school information, phone, and email context.

This allows schools to communicate like a modern institution while maintaining editorial control internally.

### 7.5 User Experience and Design Value
The school website experience is designed to be visually strong and easy to navigate for non-technical users. Schools can deliver a polished interface and smooth public UX without paying large external web design fees.

The platform enables schools to:

- Keep pages clear and readable for parents and visitors.
- Use visual content effectively to improve engagement.
- Maintain consistency between school brand and online experience.
- Update public-facing content quickly as school activities change.

### 7.6 Self-Service Editing and Configuration
Website configuration is handled from the school account management area and is built for operational simplicity.

Authorized users can:

- Open the website management interface.
- Upload and replace images.
- Create, update, reorder, or remove text sections.
- Update About details.
- Adjust website layout and style/theme choices.
- Publish changes quickly so updates appear on the school website.

All key website components are editable, removable, and maintainable over time. This ensures schools retain full control over what is shown publicly.

### 7.7 Governance and Control
Public website control remains with the school. Content publication is managed by authorized roles and permission checks, so updates are made by users responsible for institutional messaging.

This gives schools governance over:

- Accuracy of public statements.
- Brand consistency.
- Timeliness of announcements and events.
- Access control for who can change website content.

### 7.8 School Website and Admissions Visibility
The website also acts as a front door for admissions by exposing self-admission pathways when enabled by the school.

As a result:

- Families can begin applications online without physical queue pressure.
- The school receives structured candidate data through one controlled pipeline.
- Public engagement and admissions intake become connected in one digital flow.

---

## 8. Admissions

### 8.1 Admissions Model Overview
Managira supports two admissions pathways so schools can handle both public applicants and internal intake operations efficiently:

1. Self Admission (Public): parents or guardians apply through the school website.
2. School-Managed Admission (Internal): authorized school users admit students through internal workflows, including manual and bulk-assisted methods.

Both pathways converge into controlled review and enrollment steps, ensuring quality and consistency of student records.

### 8.2 Self Admission (Parent/Guardian via School Website)
Self Admission is designed to reduce long physical queues and improve convenience for families.

#### How it works
1. The school enables and exposes public admission on its website.
2. Parent or guardian opens the public admission page.
3. Applicant enters child and guardian details.
4. Required admission payment is initiated according to school-configured pricing and payment setup.
5. Application is submitted and stored as a pending admission for school review.

#### Applicant experience
- The process is digital and can be completed remotely.
- Submitted applications enter an approval queue.
- Families receive outcomes through school communication and can track progress through guardian-facing flows where available.

### 8.3 School-Managed Admission (Internal)
Internal admissions support schools when staff need to onboard students directly, especially in high-volume periods.

Schools can process admissions through:

- Manual entry for single-student intake.
- Bulk-assisted intake where files or captured content are parsed to speed up large onboarding cycles.
- Image/document-based extraction workflows that help convert uploaded information into structured student input.

This reduces repetitive data entry and improves throughput when many students are being admitted at once.

### 8.4 Data Capture During Admission
Admissions workflows support structured capture of key onboarding data, including:

- Student identity and demographic details.
- Class assignment.
- Subject linkage.
- School-year and term context.
- Expected graduation/year-group placement.
- Guardian linkage and supporting details.

Capturing these fields at intake ensures the learner enters downstream academic and reporting workflows correctly from day one.

### 8.5 Admissions Queue, Review, and Decisioning
Pending admissions are reviewed by authorized school users before final approval.

Review and decision process includes:

1. Admissions queue visibility for authorized users.
2. Ability to review and edit pending details before final decision.
3. Approval or rejection actions.
4. Communication of decisions to the applicant/guardian channels.

This protects data quality and ensures schools remain in control of final enrollment decisions.

### 8.6 Who Can Admit Students
Admissions access is permission-based. A user can admit, review, or decide applications only if their role is granted the required admission permissions.

Practically:

- Users with admissions approval permission can access pending admissions and decision workflows.
- Users with student-management permissions can execute direct internal onboarding tasks relevant to student creation and bulk intake.
- Users without these permissions cannot complete admission approval operations.

This keeps admissions authority aligned with school governance rather than role title alone.

### 8.7 Payment and Admissions Continuity
For public self-admission, payment and application capture are linked so applications can proceed through a clear, auditable sequence.

This improves operational continuity by:

- Reducing incomplete admission records.
- Keeping admission intent tied to payment context where configured.
- Making pending applications easier to track and reconcile.

### 8.8 Operational Benefits to Schools
Using Managira admissions workflows, schools gain:

- Faster onboarding cycles.
- Lower manual paperwork burden.
- Reduced queue congestion at school offices.
- Better visibility into pending and processed applications.
- Stronger consistency in class and subject assignment at intake.
- Permission-controlled governance of who can admit students.

### 8.9 Parent and Public Benefit
From the family perspective, admissions become easier, clearer, and more transparent. Applicants can submit from anywhere, avoid unnecessary delays, and receive structured progression from submission to final school decision.

### 8.10 Summary
Admissions in Managira combine public convenience with institutional control. Schools can accept applications online, process internal intake at scale, and ensure that only authorized users execute final admission actions.

---

## 9. Assessment and Tests

### 9.1 Custom Assessment Design
Managira allows each school to design assessments based on its own grading model and academic rules. Authorized users can define assessment structures, score components, and usage conditions that reflect school policy rather than a fixed platform template.

### 9.2 Controlled Management and Assignment
Assessment definitions are managed by authorized academic or administrative users and can be edited when policy changes occur. Once configured, assessments can be assigned to classes and subjects so teachers use consistent templates across the school.

### 9.3 Access Windows and Governance
Assessment workflows can be controlled through managed availability rules so only authorized users can open, edit, or activate assessment periods. This helps schools prevent uncontrolled score entry and keeps timing aligned to the school calendar.

### 9.4 Teacher Score Entry and Persistence
Teachers enter student scores through assessment workflows, and records are saved in the platform database for long-term academic continuity. These records can feed report generation and term-end academic outputs.

### 9.5 Parent and Transcript Visibility
Assessment outcomes are available to authorized stakeholders, including parent/guardian-facing academic views and transcript/report workflows where applicable. This provides a consistent academic record from class activity to formal school reporting.

### 9.6 Operational Value
Assessment management in Managira gives schools:

- Standardized grading execution across teachers.
- Institution-specific flexibility in scoring models.
- Controlled access and timing for score workflows.
- Reliable historical storage for audits and student progression analysis.

---

## 10. Attendance Tracking

### 10.1 Daily Class Attendance Workflows
Managira supports day-to-day attendance collection at class level so schools can track participation and presence consistently across the term.

### 10.2 Role-Controlled Attendance Collection
Attendance workflows are role-aware and class-aware. In practical operation, classroom attendance collection is restricted to the appropriate teacher context (including Main Teacher flow where configured), while authorized leadership roles retain oversight visibility.

### 10.3 Smart Participation Context
The platform keeps attendance history and supports practical classroom actions such as quickly confirming active/present learners during school-time collection windows. This reduces repetitive manual marking for high-confidence attendance scenarios.

### 10.4 Leadership and Parent Visibility
Attendance records are visible to school authorities for operational monitoring and intervention. Where school workflows require it, repeated absence patterns can be escalated through communication channels such as email or guardian-facing access.

### 10.5 Calendar and Holiday Alignment
Attendance behavior can be aligned to school calendar policy, including handling holiday decisions and institution-specific attendance expectations for selected dates.

### 10.6 Academic Record Continuity
Attendance data is stored as part of each student profile and can contribute to broader academic reporting and student review workflows.

---

## 11. Reports

### 11.1 Institutional and Operational Reporting
Managira provides reporting support for school-level oversight, including academic, attendance, and operational visibility required by school leaders.

### 11.2 Student Report Cards
Student report cards are produced from stored academic data and can include performance outcomes and class standing indicators based on school configuration.

### 11.3 Delivery and Distribution Channels
Reports can be generated for print workflows and can also be distributed digitally to parents/guardians through supported communication flows, including email-based delivery where configured.

### 11.4 Parent-School Communication Records
Managira supports structured communication between parents and school staff. Parents can submit child-related concerns through guardian-facing workflows, and staff can communicate behavioral or welfare reports back through controlled channels.

### 11.5 Security and Access Control
Report access follows authentication, role, and permission rules so sensitive student outcomes are only available to authorized users.

---

## 12. Promotion and Graduation

### 12.1 End-of-Term Promotion Logic
At term or semester close, schools can evaluate student outcomes and apply promotion decisions based on configured class thresholds and policy rules.

### 12.2 Configurable Cut-Off and Decision Governance
Promotion criteria are school-controlled. Authorized users can define cut-off expectations per class and decide whether students should:

- Progress to the next class.
- Repeat a class.
- Move according to institution-specific reassignment rules.

### 12.3 Scheduled and Immediate Execution
Promotion workflows support both scheduled activation and direct application by authorized users, providing operational flexibility for schools with different closure timelines.

### 12.4 Reversal and Correction Support
Promotion operations include administrative control for cancellation, reversal, and cleanup actions where correction is required after execution.

### 12.5 Graduation, Archiving, and Student Lifecycle Retention
Graduated students and students who leave the school can be archived while preserving their records for long-term institutional history. Archived lifecycle handling keeps active class lists clean without losing historical data.

### 12.6 Transfer and Record Continuity
Where schools operate within Managira-connected structures, student data continuity can be supported during transfer workflows according to organization policy and authorized access.

---

## 13. Legal Policies

### 13.1 Legal and Compliance Surface
Managira provides dedicated legal and compliance pages to support transparency and trust for schools, guardians, and public users.

### 13.2 Core Policy Pages
The platform exposes key legal content areas, including:

- Terms of Service.
- Privacy Policy.
- FAQ and public information pages.
- Help/contact flows for support and accountability.

### 13.3 Policy Communication Role
These legal pages define usage boundaries, privacy expectations, and communication standards across platform interactions, strengthening institutional compliance posture.

---

## 14. Help and Support

### 14.1 Multi-Channel Support Experience
Managira includes support pathways that allow users to request help through structured forms and self-service guidance resources.

### 14.2 Help Ticket Submission
Users can submit support requests through the help interface with essential contact details and issue context. Requests are captured as trackable conversation threads for follow-up.

### 14.3 Confirmation and Follow-Up
After submission, users receive confirmation communication and support teams can continue response workflows through managed support records.

### 14.4 Self-Service Guidance
FAQ and in-app information resources provide immediate answers for common questions, reducing resolution time for routine issues.

---

## 15. Troubleshooting and Common Issue Resolution

### 15.1 Operational Troubleshooting Approach
Managira troubleshooting is designed around fast diagnosis, clear user feedback, and continuity of critical workflows.

### 15.2 Common Resolution Patterns
Typical issue handling patterns include:

- Permission or access mismatch checks for blocked actions.
- Configuration validation for organization and feature availability.
- Retry paths for recoverable communication failures.
- Queue/history visibility for asynchronous operations (for example, email workflows).

### 15.3 School-Facing Reliability Guidance
For school operations, practical first-line checks should focus on:

- Correct role/permission assignment.
- Current school-year/term context.
- Class assignment and Main Teacher mapping where attendance depends on class ownership.
- Data completeness for report and promotion workflows.

### 15.4 Escalation to Support
When first-line checks do not resolve an issue, users can escalate through official help channels so support staff can investigate using structured ticket and workflow context.

---

## 16. Technical Overview

### 16.1 Application Architecture
Managira runs as a modular Node.js/Express application with domain-oriented routes and controller modules, shared middleware, PostgreSQL persistence, and background job support for non-interactive operations.

### 16.2 Data and Workflow Integrity
Academic, attendance, reporting, promotion, and lifecycle operations rely on database-backed records with role- and permission-governed route access. This ensures that business-critical school actions are auditable and policy-aligned.

### 16.3 Security and Access Enforcement
The platform enforces layered controls through authentication, permission middleware, feature checks, and context checks to restrict sensitive operations to authorized users.

### 16.4 Asynchronous and Communication Infrastructure
Scheduled jobs and background processes support recurring operational workloads, while email and support messaging workflows provide communication continuity without blocking core user actions.

### 16.5 Extensibility and Operational Fit
The current technical foundation is built for practical school operations: stable enough for day-to-day institutional workflows, and modular enough to evolve as schools add new process requirements.
