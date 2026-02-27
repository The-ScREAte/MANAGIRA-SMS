# Managira - School Management System

A comprehensive, all-in-one school management platform that streamlines student enrollment, academic records, reporting, and administrative tools.

## Project Overview

**Live URL**: https://www.managira.com

Managira helps schools manage:
- Student enrolment and records
- Class management and assessments
- Terminal reports and transcripts
- Guardian portal and communications
- Fee collection and Paystack integration
- Public school website and dashboard

## Technology Stack

- **Runtime**: Node.js + Express
- **Database**: PostgreSQL
- **Views**: EJS templating
- **Authentication**: Passport.js (session-based)
- **File Storage**: AWS S3
- **Payments**: Paystack
- **Email**: Nodemailer with queue processor
- **Build Tools**: Vite + TypeScript (frontend assets)

## Getting Started

### Prerequisites

- Node.js >= 18
- PostgreSQL database
- npm or bun

### Installation

```sh
# Clone the repository
git clone <YOUR_GIT_URL>

# Navigate to the project directory
cd managira-sms

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Fill in your DATABASE_URL, SESSION_SECRET, PAYSTACK keys, AWS keys, etc.

# Start the development server
npm run dev
```

## Environment Variables

Key variables required in .env:
- DATABASE_URL  PostgreSQL connection string
- SESSION_SECRET  Express session secret
- PAYSTACK_SECRET_KEY  Paystack secret key
- AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET  AWS S3 credentials
- EMAIL_USER / EMAIL_PASS  SMTP credentials

## Deployment

The app is deployed as a standard Node.js server. Ensure all environment variables are set on your hosting provider and run:

```sh
npm start
```
