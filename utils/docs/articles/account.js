"use strict";

// Account & sign-in: signing in, passwords, single sign-on, the school's sign-in rules, your profile.
module.exports = [
  {
    slug: "sign-in-to-managira",
    title: "Sign in to Managira",
    topic: "Account & sign-in",
    order: 1,
    summary: "Sign in with your email, stay signed in on your own device, enter a verification code when asked, and reach the parent, student or hub portal from one page.",
    tags: ["sign in", "log in", "login", "keep me logged in", "verification code", "parent login", "student login"],
    featured: true,
    who: "Everyone: staff, parents, students, drivers and hub users.",
    intro: "Everyone signs in on the same page. Enter your email first: if your school uses its own sign-in (single sign-on), Managira takes you there; otherwise the password box appears on the same page.",
    sections: [
      {
        title: "Sign in",
        steps: [
          ["Go to <a href=\"https://managira.com/account/login\" target=\"_blank\">managira.com/account/login</a> (or your school's address) and enter your <strong>Email address</strong>.", "sign-in.webp", "The sign-in page: email first, then your password or your school's own sign-in."],
          "Enter your <strong>Password</strong>. If your school signs in through Google, Microsoft or another provider, you go to that page instead.",
          "Tick <strong>Keep me logged in</strong> on your own device to stay signed in (30 days unless your school chose otherwise). Leave it unticked on a shared computer: you are signed out when the browser closes.",
          "If asked, enter the <strong>Verification code</strong> we emailed you (six characters, like <code>ABC123</code>) and select <strong>Verify</strong>.",
        ],
        note: "Parents, students and hub users sign in on the same page. Once the password is confirmed, they go straight to their own portal.",
      },
      {
        title: "Verification codes and remembered browsers",
        text: "Unless your school turned it off, Managira emails you a code when you sign in on a browser it doesn't know, as a second check that it's really you. The code arrives from <strong>reminders@managira.com</strong>. After a right code, that browser is remembered for your school's trust period (3 days unless your school chose otherwise), so you aren't asked every time.",
        list: [
          "Can't find the email? Check spam and junk, then select <strong>Send a new code</strong>.",
          "Signing in with your school's single sign-on skips the code: your provider has already checked you.",
          "Accounts without an email address aren't asked for a code.",
        ],
      },
      {
        title: "If a password is wrong",
        text: "Managira never locks anyone out. After a few wrong passwords, it asks you to wait a little before the next try, which stops guessing while the right password always gets you in. Use <strong>Forgot password?</strong> if you're not sure of it.",
      },
    ],
    faq: [
      ["Why was I signed out?", "Your school may sign people out after a set time (24 hours unless it chose otherwise), or you didn't tick Keep me logged in. Sign in again; nothing you saved is lost."],
      ["Can I sign in on several devices?", "Yes. Each device has its own sign-in. Use Keep me logged in only on devices you own."],
      ["Where do parents sign in?", "On the same page, with the email the school has for them. If the school hasn't invited them yet, ask the school office."],
    ],
    related: ["reset-a-password-or-recover-account-access", "single-sign-on", "tenant-configuration"],
  },
  {
    slug: "reset-a-password-or-recover-account-access",
    title: "Reset your password",
    topic: "Account & sign-in",
    order: 2,
    summary: "Forgot your password? Get a reset link by email and choose a new one, or change your password anytime in Settings, Security.",
    tags: ["forgot password", "reset password", "change password", "account recovery"],
    who: "Everyone with a Managira sign-in.",
    sections: [
      {
        title: "Reset a forgotten password",
        steps: [
          "On the sign-in page, enter your email, then select <strong>Forgot password?</strong>",
          "Check your email for the reset link (look in spam and junk too). The link works once and for a short time.",
          "Open the link, choose a new password, enter it twice and save. Then sign in with it.",
        ],
      },
      {
        title: "Change your password",
        steps: [
          ["Open <strong>Settings</strong>, then <strong>Security</strong>.", "security-settings.webp", "Settings, Security: update your email or password."],
          "Under <strong>Change Password</strong>, enter the <strong>New Password</strong> twice and select <strong>Update Password</strong>.",
        ],
        tip: "Use a long password you don't use anywhere else. A short sentence of four or five unrelated words works well.",
      },
      {
        title: "If you can't get in",
        list: [
          "<strong>No email arrives:</strong> the school may have a different address for you. Ask a manager to check it in Users / Employees (staff) or Guardians (parents).",
          "<strong>Your school uses single sign-on:</strong> reset your password with your school's provider (Google, Microsoft and so on), not in Managira.",
          "<strong>A staff member left:</strong> a manager can update their email in Users / Employees, or put the account on hold.",
        ],
      },
    ],
    faq: [
      ["Can a manager see my password?", "No. Passwords are stored in a form nobody can read, including Managira."],
      ["Can a manager reset my password for me?", "A manager can correct your email address so the reset link reaches you, and you then choose your own new password."],
    ],
    related: ["sign-in-to-managira", "single-sign-on"],
  },
  {
    slug: "single-sign-on",
    title: "Set up single sign-on (SAML or OpenID Connect)",
    topic: "Account & sign-in",
    order: 3,
    summary: "Let staff, and students if you choose, sign in with your school's own provider: Google Workspace, Microsoft Entra ID, Okta, ClassLink, Clever and more.",
    tags: ["single sign-on", "sso", "saml", "openid connect", "google workspace", "microsoft entra id", "okta", "classlink", "clever", "sign in with sso", "managira password", "everyone sso"],
    featured: true,
    who: "Managers only. Turning it on, changing it and turning it off ask for your password.",
    intro: "With single sign-on, people sign in to Managira with the account your school already gives them. Managira works with any provider that supports <strong>SAML 2.0</strong> or <strong>OpenID Connect</strong>, including Google Workspace, Microsoft Entra ID, Okta, OneLogin, ClassLink, Clever, JumpCloud, Ping, Auth0, AD FS and Shibboleth.",
    sections: [
      {
        title: "Before you start",
        list: [
          "You'll need someone who can add an app in your provider's admin console (your IT team).",
          "Every person who signs in must already have a Managira account with the same email address. Single sign-on checks who they are; their account and permissions stay in Managira.",
        ],
      },
      {
        title: "Set up and turn on single sign-on",
        steps: [
          ["Open <strong>Settings</strong>, then <strong>Tenant configuration</strong>, and scroll to <strong>Single sign-on</strong>. Under <strong>1. Your provider</strong>, choose yours (Google Workspace, Microsoft Entra ID, Okta, OneLogin and more) and the protocol (SAML or OpenID Connect).", "sso-settings.webp", "Settings, Tenant configuration, Single sign-on: choose your provider, then give your IT team the addresses shown."],
          "Select <strong>Copy all for our IT team</strong>. It copies the addresses your provider needs: for SAML the <strong>ACS URL (Reply URL)</strong> and <strong>Entity ID (Audience)</strong>; for OpenID Connect the redirect address and the scopes <code>openid email profile</code>.",
          "Your IT team adds Managira as an app in your provider, using the steps shown for that provider (for example, in the Google Admin console: Apps, Web and mobile apps, Add custom SAML app).",
          "Back in Managira, paste the provider's <strong>Metadata address</strong> (SAML) or its <strong>Issuer address</strong>, <strong>Client ID</strong> and client secret (OpenID Connect), and select <strong>Save</strong>.",
          "Select <strong>Test the connection</strong> and finish signing in on the new tab. When it works, the status says <strong>Ready to turn on</strong>.",
          "Select <strong>Turn on</strong> and confirm with your password.",
        ],
        note: "Tick <strong>Students sign in this way too</strong> if your students have accounts with your provider. Otherwise they keep signing in with passwords.",
      },
      {
        title: "Move everyone, or one person, to your provider",
        text: "Each person signs in one way: your provider, or a <strong>Managira password</strong>. Turning single sign-on on changes nobody. Then choose: to move everyone at once, select <strong>Use your provider for everyone</strong> on the Status card (it asks for your password); or move one person at a time on their staff form under <strong>How they sign in</strong>. When you add someone, <strong>Add user</strong> asks the same question, starting on your provider. The question only shows while single sign-on is on and its test has passed.",
      },
      {
        title: "How people sign in afterwards",
        text: "People enter their email on the Managira login page and select <strong>Continue</strong>. Someone set to your provider sees <strong>Your school signs in with</strong> it and a <strong>Continue with</strong> button; someone set to a Managira password sees the password box. Your main manager gets both, so someone can always get in if the provider is down. People can also start from your provider's app list.",
      },
      {
        title: "See how each person signs in",
        text: "In <strong>Management</strong>, <strong>Users / Employees</strong> has a <strong>Sign-in</strong> column while single sign-on is on: your provider's name, <strong>Managira password</strong>, or both for your main manager. <strong>Last sign-in</strong> says when someone last signed in with your provider, and the <strong>Sign-in</strong> filter lists who signs in each way, or who has used your provider.",
      },
      {
        title: "Stay safe",
        list: [
          "Your school's <strong>main manager can always sign in with a password</strong>, so nobody is locked out if the provider has an outage.",
          "Changing how single sign-on works (a new certificate, a new provider) turns it off until a new test passes.",
          "Someone set to your provider can't use a password, and someone set to a Managira password can't use your provider. Try it with a few people first and check they can sign in.",
          "Turning single sign-on off moves everyone back to Managira passwords. Anyone who never had one sets it with <strong>Forgot password?</strong>.",
          "Someone on hold, or removed, can't sign in through your provider either.",
          "<strong>Recent activity</strong> shows the latest sign-ins and any errors, to help your IT team.",
        ],
      },
    ],
    faq: [
      ["Does single sign-on create accounts?", "No. Add people in Managira first (Users / Employees, or Admissions for students), with the same email they use with your provider."],
      ["Does it work for Mira?", "Yes. Mira signs in through Managira's own page, so single sign-on applies there too."],
      ["Why does the test fail?", "Most often the provider sends a different email than the one in Managira, or the email isn't sent at all. For SAML, send the email as the NameID or in an attribute named email, and sign the assertion or the response. For OpenID Connect, check the issuer, client ID and secret."],
      ["Can we use two providers?", "One connection per school, either SAML or OpenID Connect. Choose the provider most of your people use; anyone else can keep using a password if you allow both."],
      ["What do new staff get by email?", "Someone added to sign in with your provider gets an invitation that says to log in with it, with no password to set. Someone added with a Managira password gets a link to set it. Moving someone from your provider to a password emails them that link if they don't have a password yet."],
      ["Someone set to our provider pressed Forgot password. What happens?", "No reset email is sent: the login page tells them to continue with your provider instead."],
    ],
    related: ["sign-in-to-managira", "tenant-configuration", "roles-and-permissions"],
  },
  {
    slug: "tenant-configuration",
    title: "Tenant configuration: your school's sign-in rules",
    topic: "Account & sign-in",
    order: 4,
    summary: "Choose how long people stay signed in, whether Keep me logged in is allowed, whether a code is emailed at sign-in, and how long a browser is trusted.",
    tags: ["tenant configuration", "session timeout", "keep me logged in", "verification code", "trusted devices", "security settings"],
    who: "Managers only.",
    intro: "Tenant configuration sets the sign-in rules for everyone at your school. The defaults suit most schools; change them to match your district's security policy.",
    sections: [
      {
        title: "Change the rules",
        steps: [
          ["Open <strong>Settings</strong>, then <strong>Tenant configuration</strong>.", "tenant-configuration.webp", "Settings, Tenant configuration: sign-in rules for everyone at your school."],
          "Adjust the settings below and save. They apply from each person's next sign-in.",
        ],
      },
      {
        title: "The settings",
        table: [
          ["Setting", "What it does", "Default"],
          ["<strong>Session timeout</strong>", "Signs people out after this long, even if they're active: 8, 12, 24 or 72 hours, or 7 days.", "24 hours"],
          ["<strong>Allow Keep me logged in</strong>", "Shows the Keep me logged in box at sign-in.", "On"],
          ["<strong>Keep me logged in for</strong>", "How long a ticked Keep me logged in lasts: 7, 14, 30, 60 or 90 days.", "30 days"],
          ["<strong>Email a code at sign-in</strong>", "Asks for a code sent by email after the password, on a browser that isn't remembered.", "On"],
          ["<strong>Allow device to be remembered</strong>", "After a right code, skips the code on that browser for a while.", "On"],
          ["<strong>Trust duration</strong>", "How long a browser stays remembered, counted from the code: 1, 3, 7, 14 or 30 days.", "3 days"],
        ],
        note: "If the settings can't be read for a moment, nobody is signed out because of it.",
      },
    ],
    faq: [
      ["Does this affect single sign-on?", "Single sign-on skips the emailed code, because your provider has already checked the person. Session timeout still applies."],
      ["Do the rules apply to parents?", "Yes. They apply to everyone who signs in to your school."],
    ],
    related: ["sign-in-to-managira", "single-sign-on"],
  },
  {
    slug: "profile-and-appearance",
    title: "Your profile, appearance and notifications",
    topic: "Account & sign-in",
    order: 5,
    summary: "Change your photo and name, choose Light, Classic or Dark appearance, update your email or password, and choose which emails you get.",
    tags: ["profile", "appearance", "dark mode", "notifications", "email preferences", "settings"],
    who: "Everyone. Parents and students have Settings in their own portal.",
    sections: [
      {
        title: "Your photo and name",
        steps: [
          ["Open the menu (☰) and choose <strong>Settings</strong>, then <strong>Profile</strong>.", "profile-settings.webp", "Settings, Profile: your appearance, photo and name."],
          "Under <strong>Your details</strong>, select <strong>Change photo</strong>, or edit your first and last name, and save.",
        ],
      },
      {
        title: "Light, Classic or Dark",
        text: "At the top of <strong>Profile</strong>, choose <strong>Appearance</strong>: Light, Classic or Dark. Your choice follows you on every device. Parents and students choose theirs in <strong>Settings</strong> in their portal.",
      },
      {
        title: "Email, password and notifications",
        list: [
          "<strong>Settings, Security</strong>: change your email address or password.",
          "<strong>Settings, Notifications</strong>: choose which emails you get, such as events and announcements, messages and reminders.",
        ],
      },
    ],
    faq: [
      ["Why can't I change my email?", "Your school may manage emails centrally, or use single sign-on. Ask a manager."],
    ],
    related: ["sign-in-to-managira", "email-notifications-reference"],
  },
];
