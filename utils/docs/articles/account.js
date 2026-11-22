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
          "If asked, enter the <strong>Verification code</strong> we emailed you (six characters, like <code>ABC123</code>), or the 6-digit code from your authenticator app if you use one, and select <strong>Verify</strong>.",
        ],
        note: "Parents, students and hub users sign in on the same page. Once the password is confirmed, they go straight to their own portal.",
      },
      {
        title: "Verification codes and remembered browsers",
        text: "Unless your school turned it off, Managira emails you a code when you sign in on a browser it doesn't know, as a second check that it's really you. The code arrives from <strong>reminders@managira.com</strong>. After a right code, that browser is remembered for your school's trust period (3 days unless your school chose otherwise), so you aren't asked every time.",
        list: [
          "Can't find the email? Check spam and junk, then select <strong>Send a new code</strong>.",
          "If you use an authenticator app, Managira asks for the app's code instead, and sends no email. See " + "<a href=\"/legal/user-documentation/two-step-sign-in\">Two-step sign-in with an authenticator app</a>.",
          "Signing in with your school's single sign-on skips the code: your provider has already checked you.",
          "Accounts without an email address aren't asked for an emailed code.",
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
    related: ["reset-a-password-or-recover-account-access", "two-step-sign-in", "single-sign-on", "tenant-configuration"],
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
        title: "Password rules",
        list: [
          "At least 8 characters. Some forms also ask for a mix of letters, numbers and symbols.",
          "A password that has appeared in a known data breach is refused, even if it looks strong. Your password never leaves Managira for this check: only the first five characters of a scrambled (hashed) copy are looked up in a public list of breached passwords, and the match is made on Managira's side.",
          "Changing your password signs you out on your other devices.",
        ],
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
          "You'll need someone who can add an app in your provider's admin console (your IT team). Send them the <a href=\"/legal/user-documentation/single-sign-on-it-administrators\">Single sign-on setup guide for IT administrators</a>.",
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
        text: "People enter their email on the Managira login page and select <strong>Continue</strong>. Someone set to your provider sees <strong>Your school signs in with</strong> it and a <strong>Continue with</strong> button; someone set to a Managira password sees the password box. Your main manager always keeps a password, so someone can still get in if the provider is down, and is also offered your provider once they turned single sign-on on themselves. People can also start from your provider's app list.",
      },
      {
        title: "See how each person signs in",
        text: "In <strong>Management</strong>, <strong>Users / Employees</strong> has a <strong>Sign-in</strong> column while single sign-on is on: your provider's name, <strong>Managira password</strong>, or both for your main manager. <strong>Last sign-in</strong> says when someone last signed in with your provider, and the <strong>Sign-in</strong> filter lists who signs in each way, or who has used your provider.",
      },
      {
        title: "Stay safe",
        list: [
          "Your school's <strong>main manager can always sign in with a password</strong>, so nobody is locked out if the provider has an outage. Your provider opens the main manager's account only if they turned single sign-on on themselves.",
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
    related: ["single-sign-on-it-administrators", "sign-in-to-managira", "tenant-configuration", "roles-and-permissions"],
  },
  {
    slug: "single-sign-on-it-administrators",
    title: "Single sign-on setup guide for IT administrators",
    topic: "Account & sign-in",
    order: 3.5,
    summary: "What your IT team sets up in Google Workspace, Microsoft Entra ID, Okta, ClassLink, Clever or any SAML or OpenID Connect provider, then tests and rolls out.",
    tags: ["it administrator", "it team", "identity provider configuration", "acs url", "entity id", "redirect uri", "idp metadata", "nameid", "google admin console", "entra id", "azure ad", "signing certificate"],
    who: "Your school's or district's IT administrator, working with a Managira manager.",
    intro: "Managira works with any identity provider that supports <strong>SAML 2.0</strong> or <strong>OpenID Connect</strong>. Your provider proves who the person is; their account, role and permissions stay in Managira. Managira never sees their provider password, and no software is installed on your side.",
    sections: [
      {
        title: "Who does what",
        table: [
          ["Step", "Who", "Where"],
          ["Choose the provider and protocol, and copy the addresses", "A Managira manager", "Settings › Tenant configuration › Single sign-on › <strong>Copy all for our IT team</strong>"],
          ["Add Managira as an application", "IT administrator", "Your provider's admin console (steps below)"],
          ["Paste the provider's details, test, turn on", "The Managira manager", "The same Settings page"],
          ["Move people to the provider", "The Managira manager", "<strong>Use your provider for everyone</strong>, or one person at a time on Edit user"],
        ],
        note: "Every person must already have a Managira account with the same email address the provider sends. Single sign-on doesn't create accounts.",
      },
      {
        title: "SAML 2.0: what to configure",
        list: [
          "<strong>ACS URL (Reply URL)</strong> and <strong>Entity ID (Audience)</strong>: copy them from Managira's settings page; each school has its own.",
          "<strong>NameID</strong>: the person's email address (format emailAddress), or send the email in an attribute named <code>email</code>. If your provider uses another attribute name, the manager enters it under Advanced.",
          "<strong>Signing</strong>: sign the assertion or the whole response (SHA-256 recommended). Unsigned answers are refused.",
          "<strong>Back to Managira</strong>: give the manager your provider's <strong>metadata address</strong> (the simplest: it fills in everything), or the metadata XML, or the Entity ID, sign-in (SSO) URL and signing certificate.",
          "<strong>Start URL</strong> (optional): add it as the app's link in your users' app launcher.",
        ],
      },
      {
        title: "OpenID Connect: what to configure",
        list: [
          "Create a <strong>web application</strong> that uses the authorization code flow (Managira adds PKCE).",
          "<strong>Redirect URI</strong>: copy it from Managira's settings page.",
          "<strong>Scopes</strong>: <code>openid email profile</code>. The ID token must carry the person's email; an email your provider marks as unverified is refused.",
          "<strong>Back to Managira</strong>: the issuer address, the client ID and the client secret. The secret is stored encrypted and is never shown again.",
          "Microsoft Entra ID only: when the email claim is missing, Managira uses the user principal name, which your organization assigns.",
        ],
      },
      {
        title: "Provider by provider",
        table: [
          ["Provider", "SAML 2.0", "OpenID Connect"],
          ["Google Workspace", "Admin console › Apps › Web and mobile apps › Add app › Add custom SAML app. Download the IdP metadata and give it to the manager to paste. Map Primary email to the NameID.", "Google Cloud › APIs & Services › Credentials › Create OAuth client ID (Web application). Issuer: <code>https://accounts.google.com</code>"],
          ["Microsoft Entra ID", "Entra admin center › Enterprise applications › New application › Create your own › Single sign-on › SAML. Copy the App Federation Metadata Url.", "App registrations › New registration (Web). Issuer: <code>https://login.microsoftonline.com/&lt;tenant-id&gt;/v2.0</code>"],
          ["Okta", "Applications › Create App Integration › SAML 2.0. Name ID format EmailAddress, application username Email. Copy the Metadata URL.", "Applications › Create App Integration › OIDC › Web Application. Issuer: your Okta address"],
          ["ClassLink", "Management Console › Single Sign-On › SAML Console › Add. Copy the metadata address.", "Ask ClassLink support for an OpenID Connect app with Managira's redirect URI."],
          ["Clever", "Your SAML connector settings. Clever gives the metadata address.", "Not used."],
          ["Others (OneLogin, JumpCloud, PingOne, Auth0, AD FS, Shibboleth)", "Add a custom SAML application with the values above. AD FS metadata is at <code>https://&lt;server&gt;/FederationMetadata/2007-06/FederationMetadata.xml</code>; Shibboleth must release the mail attribute.", "Add a web application with the values above."],
        ],
      },
      {
        title: "Test, then roll out",
        steps: [
          "The manager saves your details and selects <strong>Test the connection</strong>, then signs in on the new tab with a test account that exists in Managira. Nothing changes for anyone until the test passes.",
          "The manager selects <strong>Turn on</strong> and confirms with their password. Turning it on moves nobody.",
          "Move two or three people first (Edit user › How they sign in) and check they can sign in from the login page and from your app launcher.",
          "Then move everyone with <strong>Use your provider for everyone</strong>, and send staff the short note: enter your email on the Managira login page and choose Continue.",
        ],
        note: "Students sign in through the provider only if the manager ticks <strong>Students sign in this way too</strong>.",
      },
      {
        title: "Security notes for your records",
        list: [
          "Your provider's own multi-factor authentication and password rules apply to every sign-in through it. Managira doesn't ask for its own code on top.",
          "Each answer from your provider is checked for signature, audience, time and replay, and can only sign in an account of your school. It can never sign in a Managira platform administrator.",
          "The school's <strong>main manager always keeps a Managira password</strong>, so someone can still get in if your provider is down. Keep that account's password and its own two-step sign-in in a safe place.",
          "Changing the certificate, the metadata or the protocol turns single sign-on off until a new test passes. Plan certificate rollovers: paste the new certificate, test, turn on.",
          "A session that came through your provider ends when the browser closes, and after the school's session time. Someone on hold or removed in Managira can't sign in through the provider.",
          "<strong>Recent activity</strong> on the settings page shows the latest sign-ins and refusals, with the reason, to help with troubleshooting.",
        ],
      },
      {
        title: "Troubleshooting",
        table: [
          ["What you see", "What to check"],
          ["The test says no email was sent", "Send the email as the NameID (SAML) or include the <code>email</code> scope and claim (OpenID Connect), or set the attribute name under Advanced."],
          ["The test says no account matches", "The email your provider sends must match the person's email in Managira exactly (case doesn't matter)."],
          ["Signature or certificate refused", "Sign the assertion or the response, and paste the current signing certificate (or read the metadata again)."],
          ["Audience or ACS refused", "The Entity ID and ACS URL in your provider must be exactly the ones Managira shows for this school."],
          ["It worked, then stopped", "Someone changed the provider's details: test again and turn it back on."],
        ],
      },
    ],
    faq: [
      ["Does Managira support SCIM or automatic account creation?", "No. Add people in Managira (Users / Employees, or Admissions for students), or move your records in with a data migration. Single sign-on only checks who they are."],
      ["Can we use two providers?", "One connection per school. Pick the provider most of your people use; anyone else keeps a Managira password."],
      ["Where are the provider details stored?", "With the school's other settings in the United States. OpenID Connect client secrets are encrypted (AES-256-GCM)."],
    ],
    related: ["single-sign-on", "tenant-configuration", "two-step-sign-in"],
  },
  {
    slug: "tenant-configuration",
    title: "Tenant configuration: your school's sign-in rules",
    topic: "Account & sign-in",
    order: 4,
    summary: "Choose how long people stay signed in, Keep me logged in, the emailed code, trusted browsers, and who must use an authenticator app.",
    tags: ["tenant configuration", "session timeout", "keep me logged in", "verification code", "trusted devices", "security settings", "two-step sign-in", "require authenticator", "mfa policy"],
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
          ["<strong>Authenticator app at sign-in</strong>", "Under Two-step sign-in: let each person choose, or require an authenticator app for managers and supervisors (and your school's own account), or for all staff.", "Each person chooses"],
        ],
        note: "If the settings can't be read for a moment, nobody is signed out because of it.",
      },
      {
        title: "Two-step sign-in",
        text: "The <strong>Two-step sign-in</strong> card sets who must use an authenticator app, and lists everyone who uses one, each with a <strong>Reset</strong> button for when someone loses their phone (it asks for your password). See <a href=\"/legal/user-documentation/two-step-sign-in\">Two-step sign-in with an authenticator app</a>.",
      },
    ],
    faq: [
      ["Does this affect single sign-on?", "Single sign-on skips the emailed code and the authenticator app, because your provider has already checked the person with its own two-step sign-in. Session timeout still applies."],
      ["Do the rules apply to parents?", "The session and code rules do. The authenticator app is for staff and your school's own account; parents and students keep the emailed code."],
      ["Can we turn the emailed code off but keep the authenticator app?", "Yes. Turning off <strong>Email a code at sign-in</strong> never turns off the app: anyone who uses one is still asked for its code."],
    ],
    related: ["sign-in-to-managira", "two-step-sign-in", "single-sign-on"],
  },
  {
    slug: "two-step-sign-in",
    title: "Two-step sign-in with an authenticator app",
    topic: "Account & sign-in",
    order: 4.5,
    summary: "Protect sign-ins with a code from a phone app. Managers set it up in Settings and can require it for managers, all staff or one person.",
    tags: ["two-step sign-in", "two-factor", "2fa", "mfa", "multi-factor authentication", "authenticator app", "google authenticator", "microsoft authenticator", "authy", "recovery codes", "lost phone", "require mfa", "security"],
    featured: true,
    who: "Managers and staff with Settings access set it up for themselves. Anyone the school requires it for is shown how when they sign in.",
    intro: "With two-step sign-in, signing in with your password also asks for a 6-digit code from an authenticator app on your phone. Someone who learns your password still can't open your account without your phone.",
    sections: [
      {
        title: "Turn it on for yourself",
        steps: [
          "Install an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator, 1Password or Authy.",
          "In Managira, open <strong>Settings</strong>, then <strong>Two-step sign-in</strong> (the <strong>?</strong> menu has a shortcut).",
          "Select <strong>Set up</strong>. In your app, add an account (usually the <strong>+</strong> button) and scan the QR code. If you can't scan it, type the key shown beside it.",
          "Enter the 6-digit code your app shows and select <strong>Turn on</strong>.",
          "Save your 10 <strong>recovery codes</strong>: print them or keep them in a password manager. They're shown only once.",
        ],
      },
      {
        title: "Sign in with the app",
        list: [
          "Enter your email and password as usual. Managira then asks for the code from your app instead of emailing one.",
          "The app shows a new code every 30 seconds. Type the newest one; each code works once.",
          "If your school lets browsers be remembered, a right code also remembers that browser for the school's trust period (3 days unless it chose otherwise), so you aren't asked every time on your own computer.",
          "After 5 wrong codes, wait 10 minutes, then sign in again.",
        ],
        tip: "If a right code is refused, check that your phone sets its time automatically. Codes depend on the clock.",
      },
      {
        title: "Lost or replaced your phone",
        list: [
          "Type one of your recovery codes where the app's code goes (they look like <code>ab12c-34de5</code>). Each works once, and Managira tells you how many are left.",
          "Then open <strong>Settings</strong>, <strong>Two-step sign-in</strong>: turn it off and set it up on your new phone, or ask a manager to reset it.",
          "No recovery codes left? Ask a manager at your school to reset your app (below). You set it up again the next time you sign in.",
        ],
      },
      {
        title: "Turn it off",
        text: "Open <strong>Settings</strong>, <strong>Two-step sign-in</strong>, type your password and select <strong>Turn off</strong>. If your school requires the app for you, it can't be turned off; a manager can reset it so you can move it to a new phone.",
      },
      {
        title: "Require it at your school (managers)",
        steps: [
          "Open <strong>Settings</strong>, then <strong>Tenant configuration</strong>, and find <strong>Two-step sign-in</strong>.",
          "Under <strong>Authenticator app at sign-in</strong>, choose <strong>Each person chooses</strong> (the default), <strong>Required for managers and supervisors</strong> (your school's own account too), or <strong>Required for all staff</strong>, and select <strong>Save</strong>.",
          "Anyone required to use it who hasn't set it up is taken to <strong>Settings</strong>, <strong>Two-step sign-in</strong> the next time they open Managira, and can't open other pages until it's on. This works for every member of staff, even without Settings access.",
        ],
        note: "Changes are recorded in your school's activity log.",
      },
      {
        title: "Require it for one person (managers)",
        steps: [
          "In <strong>Management</strong>, open <strong>Users / Employees</strong> and choose <strong>Edit</strong> beside the person.",
          "Tick <strong>Require an authenticator app at sign-in</strong>, confirm the access, and select <strong>Save Changes</strong>.",
        ],
        note: "Untick it to go back to your school's rule for them. Only managers see this choice.",
      },
      {
        title: "Reset someone's app (managers)",
        steps: [
          "In <strong>Settings</strong>, <strong>Tenant configuration</strong>, <strong>Two-step sign-in</strong> lists everyone at your school who uses an authenticator app.",
          "Select <strong>Reset</strong> beside the person and confirm with your own password.",
          "Their old app and recovery codes stop working. If the app is still required for them, they set it up again when they next sign in.",
        ],
        note: "Before you reset, make sure it's really them asking, for example by phone or in person. Someone who has taken over an email account may ask for a reset.",
      },
    ],
    faq: [
      ["Does it work with single sign-on?", "People who sign in through your school's single sign-on provider aren't asked for the app: your provider checks them with its own two-step sign-in. The app is used whenever they sign in with a Managira password."],
      ["Do parents and students use it?", "No. Parents and students sign in as before, with the emailed code when your school uses it."],
      ["Is this the same app as the one for the data migration?", "Yes. One authenticator app covers both: two-step sign-in and the sensitive pages that ask for a code."],
      ["What if the code check can't run for a moment?", "Nobody is locked out because a check couldn't run. Managira checks again on the next page."],
      ["Does Managira need my phone number?", "No. The authenticator app works without a phone number or a signal."],
    ],
    related: ["sign-in-to-managira", "tenant-configuration", "authenticator-codes", "reset-a-password-or-recover-account-access"],
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
          "<strong>Settings, Notifications</strong>: one list for everything you are told about. Choose alerts (scores, absences and the bus), and which emails you get, and how: in Managira, by email, by text or in the weekly briefing. One <strong>Save</strong> saves them all. See <a href=\"/legal/user-documentation/notifications-and-alerts\">Your notifications and alerts</a>.",
        ],
      },
    ],
    faq: [
      ["Why can't I change my email?", "Your school may manage emails centrally, or use single sign-on. Ask a manager."],
    ],
    related: ["sign-in-to-managira", "email-notifications-reference"],
  },
  {
    slug: "authenticator-codes",
    title: "Authenticator codes for sensitive pages",
    topic: "Account & sign-in",
    order: 30,
    summary: "Your data migration and restricted student information ask for a code from an authenticator app. Set it up once, and what to do if you lose your phone.",
    tags: ["authenticator", "authenticator app", "2fa", "two-factor", "mfa", "verification code", "6-digit code", "recovery codes", "lost phone", "google authenticator", "microsoft authenticator"],
    who: "School managers who open a data migration or restricted information from an old system.",
    intro: "Some pages hold especially sensitive information, such as your school's data migration and restricted details brought from an old system. To open them, Managira asks for your password and a 6-digit code from an authenticator app on your phone.",
    sections: [
      {
        title: "Set it up (once)",
        steps: [
          "Install an authenticator app on your phone: Google Authenticator, Microsoft Authenticator, 1Password or Authy.",
          "Open the page. Managira shows a QR code: scan it with the app (or type the key under it).",
          "Type your password and the 6-digit code the app shows, then select <strong>Turn it on</strong>.",
          "Save your 10 <strong>recovery codes</strong> somewhere safe. They're shown once.",
        ],
      },
      {
        title: "Each time",
        list: [
          "Type your password and the newest code from the app.",
          "The app shows a new code every 30 seconds. Each code works once.",
          "Once you're in, you aren't asked again for 30 minutes.",
          "After 5 wrong codes, wait 10 minutes before trying again.",
        ],
        tip: "If a right code is refused, check your phone's time is set automatically.",
      },
      {
        title: "Lost your phone?",
        text: "Type one of your recovery codes in place of the 6-digit code. Each works once. If you have none left, contact Managira support: <a href=\"mailto:support@managira.com\">support@managira.com</a>. Once we've checked it's you, we reset your authenticator and you set it up again.",
      },
    ],
    faq: [
      ["I already use an authenticator app to sign in. Do I set up another?", "No. The app you use for two-step sign-in also gives the codes these pages ask for."],
    ],
    related: ["two-step-sign-in", "work-through-your-data-migration", "moving-to-managira"],
  },
];
