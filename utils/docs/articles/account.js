"use strict";

// Account & sign-in: signing in, passwords, single sign-on, the school's sign-in rules, your profile.

const link = (slug, title) => `<a href="/legal/user-documentation/${slug}">${title}</a>`;

module.exports = [
  {
    slug: "sign-in-to-managira",
    title: "Sign in to Managira",
    topic: "Account & sign-in",
    order: 1,
    summary: "Sign in with your email, then your password, your school's own sign-in or an emailed code. For staff, parents, students and districts.",
    tags: ["sign in", "log in", "login", "keep me logged in", "verification code", "parent login", "student login", "session timed out", "trusted browser", "continue with"],
    featured: true,
    who: "Everyone: staff, parents, students, drivers and hub (district) users.",
    intro: "Everyone signs in on the same page, with an email first. Managira then shows only what that person needs: a password box, or their school's own sign-in button.",
    sections: [
      {
        title: "Sign in with your email and password",
        steps: [
          ["Go to <a href=\"https://managira.com/account/login\" target=\"_blank\">managira.com/account/login</a>, or select <strong>Login</strong> on your school's website. Type your <strong>Email address</strong> and select <strong>Continue</strong>.", "account-login-email.webp", "The sign-in page asks for your email first."],
          ["Type your <strong>Password</strong> and select <strong>Log in</strong>. Select the eye to see what you typed."],
          ["Check <strong>Keep me logged in</strong> only on your own device (see below)."],
          "If your school asks for a code, enter it (next section). You then land on your home screen.",
        ],
        note: "Parents, students, drivers and district users use this same page. Once the password is right, each goes straight to their own portal.",
      },
      {
        title: "Enter the emailed code",
        text: "Unless your school turned it off, Managira emails a six-character code after a right password, as a second check that it's really you. It comes from <strong>reminders@managira.com</strong> and lasts 10 minutes.",
        steps: [
          ["Open the email and type the code in <strong>Verification code</strong>, then select <strong>Verify</strong>.", "account-login-code.webp", "Check your email: type the six characters."],
          ["No email? Look in spam and junk, then select <strong>Send a new code</strong>."],
        ],
        list: [
          "After a right code, that browser is remembered for your school's trust period (3 days unless your school chose otherwise), so you aren't asked every time. The days count from the code, and signing in again doesn't extend them.",
          "If you use an authenticator app, Managira asks for its 6-digit code instead and sends no email. See " + link("two-step-sign-in", "Two-step sign-in") + ".",
          "Single sign-on skips the code: your provider has already checked you. Accounts with no email address aren't asked for one.",
        ],
      },
      {
        title: "Keep me logged in",
        images: [],
        list: [
          "Checked, you stay signed in even after closing the browser, for 30 days unless your school chose otherwise, until you log out or clear your browser's cookies.",
          "Unchecked, you are signed out when the browser closes.",
          "Don't check it on a public or shared computer.",
          "If your school turned it off, the box isn't there.",
        ],
      },
      {
        title: "If your school uses single sign-on",
        text: "After you enter your email, Managira may say <strong>Your school signs in with</strong> a provider such as Google Workspace or Microsoft. Select <strong>Continue with</strong> that provider and sign in there. Nothing is sent to the provider until you choose it.",
        images: [],
        note: "See " + link("single-sign-on", "Set up single sign-on") + ". Your school's main manager always keeps a password, so someone can get in if the provider is down.",
      },
      {
        title: "Parents and students",
        text: "Parents and students can use the main sign-in page above. Your school may also give you a page of your own:",
        list: [
          "<strong>Parent sign in</strong> (<code>managira.com/account/guardian-login</code>) takes an <strong>Email or Phone Number</strong> and your <strong>Password</strong>.",
          "<strong>Student sign in</strong> (<code>managira.com/account/student-login</code>) takes your <strong>Student Email</strong> and <strong>Password</strong>.",
          "First time? Your school sends you an email invitation with a link to set your password. Ask the school office if you haven't had one.",
        ],
        images: [["account-login-parent.webp", "The parent sign-in page."], ["account-login-student.webp", "The student sign-in page."]],
        note: "A parent with children at more than one Managira school signs in once with the same email. See " + link("parent-portal", "The parent portal") + ".",
      },
      {
        title: "If you were signed out",
        text: "If you are quiet for a long time, or your school's sign-in time is up, the page you had open goes to the sign-in page with a message. Sign in again and you come back to where you were.",
        list: [
          "<strong>Your session timed out</strong>: you were quiet for a while.",
          "<strong>Your sign-in has expired</strong>: sign-ins last a set time, set in " + link("tenant-configuration", "Tenant configuration") + ".",
          "Nothing you saved is lost. If you chose <strong>Logout</strong> yourself, you get a plain sign-in page instead.",
        ],
      },
      {
        title: "If a password is wrong",
        text: "Managira never locks anyone out. After a few wrong passwords it asks you to wait a little before the next try, which stops guessing while the right password always gets you in. Select <strong>Forgot password?</strong> if you're not sure of it. See " + link("reset-a-password-or-recover-account-access", "Reset your password") + ".",
      },
    ],
    faq: [
      ["Why was I signed out?", "You were quiet for a while, your school's sign-in time ended (24 hours unless it chose otherwise), or you didn't check Keep me logged in. Sign in again; nothing you saved is lost."],
      ["Can I sign in on several devices?", "Yes. Each device has its own sign-in. Use Keep me logged in only on devices you own."],
      ["Where do parents sign in?", "On the same page, with the email the school has for them, or on the Parent sign in page with an email or phone number. If the school hasn't invited you yet, ask the school office."],
      ["I never get the verification code.", "Check spam and junk for reminders@managira.com, then select Send a new code. If it still doesn't come, the school may have a different email for you: ask a manager to check it."],
      ["Why am I asked for a code only sometimes?", "A browser that entered a right code is remembered for your school's trust period. A new browser, a cleared browser or a private window asks again."],
    ],
    related: ["reset-a-password-or-recover-account-access", "two-step-sign-in", "single-sign-on", "tenant-configuration", "troubleshooting-common-issues"],
  },
  {
    slug: "reset-a-password-or-recover-account-access",
    title: "Reset your password",
    topic: "Account & sign-in",
    order: 2,
    summary: "Forgot your password? Get a reset link by email and choose a new one, or change it any time in Settings › Security.",
    tags: ["forgot password", "reset password", "change password", "account recovery", "reset link", "locked out"],
    who: "Everyone with a Managira sign-in. Someone who signs in with their school's provider resets their password there.",
    intro: "A forgotten password is fixed from the sign-in page with an emailed link. If you remember it and want a new one, change it in Settings.",
    sections: [
      {
        title: "Reset a forgotten password",
        steps: [
          ["On the sign-in page, select <strong>Forgot password?</strong> above the password box."],
          ["Enter your <strong>Email Address</strong> and select <strong>Send Reset Link</strong>.", "account-forgot-password.webp", "The Forgot password page."],
          "Open the email (check spam and junk too). The link works once and for a short time.",
          "On the <strong>Reset password</strong> page, type your <strong>New Password</strong>, type it again in <strong>Confirm Password</strong> and select <strong>Reset Password</strong>. Then sign in.",
        ],
      },
      {
        title: "Change your password",
        steps: [
          ["Open the <strong>☰</strong> menu, select <strong>Settings</strong>, then <strong>Security</strong> (parents and students: <strong>Settings</strong> in their portal)."],
          "Select <strong>Expand</strong> beside <strong>Change Password</strong>.",
          "Type the <strong>New Password</strong> twice and select <strong>Update Password</strong>.",
        ],
        tip: "Use a long password you don't use anywhere else. A short sentence of four or five unrelated words works well.",
      },
      {
        title: "Password rules",
        list: [
          "At least 10 characters, with an uppercase letter, a lowercase letter, a number and a special character, and not a common password. A new password can be up to 72 characters.",
          "A password that has appeared in a known data breach is refused, even if it looks strong. Your password never leaves Managira for this check: only the first five characters of a scrambled (hashed) copy are looked up, and the match is made on Managira's side.",
        ],
      },
      {
        title: "If you can't get in",
        list: [
          "<strong>No email arrives:</strong> the school may have a different address for you. Ask a manager to check it in Users / Employees (staff) or Parents &amp; guardians (parents).",
          "<strong>Your school uses single sign-on:</strong> use <strong>Continue with</strong> your provider. If you press Forgot password?, the sign-in page tells you to do that, and sends no email.",
          "<strong>A staff member left:</strong> a manager can update their email in Users / Employees, or put the account on hold.",
        ],
      },
    ],
    faq: [
      ["Can a manager see my password?", "No. Passwords are stored in a form nobody can read, including Managira."],
      ["Can a manager reset my password for me?", "A manager can correct your email address so the reset link reaches you, and you then choose your own new password."],
      ["Who can change the school's own sign-in email and password?", "Only the school's own account. Every member of staff, managers included, changes only their own."],
    ],
    related: ["sign-in-to-managira", "single-sign-on", "profile-and-appearance"],
  },
  {
    slug: "single-sign-on",
    title: "Set up single sign-on (SAML or OpenID Connect)",
    topic: "Account & sign-in",
    order: 3,
    summary: "Let staff, and students if you choose, sign in with your school's own provider: Google Workspace, Microsoft Entra ID, Okta, ClassLink, Clever and more.",
    tags: ["single sign-on", "sso", "saml", "openid connect", "google workspace", "microsoft entra id", "okta", "classlink", "clever", "sign in with sso", "managira password", "everyone sso", "continue with"],
    featured: true,
    who: "Managers only. Turning it on, changing it and turning it off ask for your password.",
    intro: "With single sign-on, people sign in to Managira with the account your school already gives them. Managira works with any provider that supports <strong>SAML 2.0</strong> or <strong>OpenID Connect</strong>, including Google Workspace, Microsoft Entra ID, Okta, OneLogin, ClassLink, Clever, JumpCloud, Ping, Auth0, AD FS and Shibboleth.",
    sections: [
      {
        title: "Before you start",
        list: [
          "You'll need someone who can add an app in your provider's admin console (your IT team). Send them the " + link("single-sign-on-it-administrators", "Single sign-on setup guide for IT administrators") + ".",
          "Every person who signs in must already have a Managira account with the same email address. Single sign-on checks who they are; their account and permissions stay in Managira.",
        ],
      },
      {
        title: "Set up and turn on single sign-on",
        steps: [
          ["Open <strong>Settings</strong>, then <strong>Tenant configuration</strong>. The <strong>Single sign-on</strong> card is at the bottom. It says <strong>Not set up</strong> until you start.", "account-settings-tenant.webp", "Settings › Tenant configuration, with Single sign-on at the bottom."],
          ["Under <strong>Provider</strong>, choose yours, and the <strong>Type</strong> (SAML 2.0 or OpenID Connect). Not sure? Choose SAML 2.0."],
          "Select <strong>Copy all</strong>, or <strong>Copy</strong> beside each address. For SAML these are the <strong>ACS URL</strong> and <strong>Entity ID</strong>; for OpenID Connect, the redirect address and the scopes <code>openid email profile</code>. Give them to your IT team.",
          "Your IT team adds Managira as an app in your provider, using the steps in " + link("single-sign-on-it-administrators", "the IT guide") + ".",
          "Back in Managira, paste the provider's <strong>Metadata address</strong> and select <strong>Read it</strong> (SAML), or its <strong>Issuer address</strong>, <strong>Client ID</strong> and <strong>Client secret</strong> (OpenID Connect). Type your password beside <strong>Save</strong> and select <strong>Save</strong>.",
          "Select <strong>Test</strong> and finish signing in on the new tab. When it works, the card says <strong>Ready</strong> and <strong>Test worked for</strong> your email.",
          ["Select <strong>Turn on</strong>. The card now says <strong>On</strong>.", "account-sso-on-zoom.webp", "Single sign-on is on. Turning it on moves nobody yet."],
        ],
        note: "Switch on <strong>Students too</strong> if your students have accounts with your provider. Otherwise they keep signing in with passwords.",
      },
      {
        title: "Move everyone, or one person, to your provider",
        text: "Each person signs in one way: your provider, or a <strong>Managira password</strong>. Turning single sign-on on changes nobody. Then choose:",
        list: [
          "<strong>Everyone at once:</strong> select <strong>Use your provider for everyone</strong> (it shows the provider's name) and confirm with your password.",
          "<strong>Some people:</strong> select <strong>Choose people</strong>, or set <strong>How they sign in</strong> on a person's staff form in <strong>Management Tools › Users / Employees</strong>. <strong>Add user</strong> asks the same question for new staff, starting on your provider.",
        ],
        note: "<strong>How they sign in</strong> appears only while single sign-on is tested and on. Try a few people first.",
      },
      {
        title: "What people see afterwards",
        text: "People enter their email on the Managira sign-in page and select <strong>Continue</strong>. Someone on your provider sees <strong>Your school signs in with</strong> the provider and a <strong>Continue with</strong> button. Someone on a Managira password sees the password box. People can also start from your provider's app list.",
        images: [],
        note: "<strong>Users / Employees</strong> then shows a <strong>Sign-in</strong> column, with each person's way in and when they last used your provider.",
      },
      {
        title: "Stay safe",
        list: [
          "Your school's <strong>main manager can always sign in with a password</strong>, so nobody is locked out if the provider has an outage. Your provider opens the main manager's account only if they turned single sign-on on themselves.",
          "Changing how single sign-on works (a new certificate, a new provider) turns it off until a new test passes.",
          "Someone set to your provider can't use a password, and someone set to a Managira password can't use your provider.",
          "Turning it off moves everyone back to Managira passwords. Anyone who never had one sets it with <strong>Forgot password?</strong>.",
          "Someone on hold, or removed, can't sign in through your provider either.",
          "<strong>Recent activity</strong> on the card shows the latest sign-ins and any errors, to help your IT team.",
          "<strong>Remove connection</strong> at the bottom deletes the setup (it asks for your password).",
        ],
      },
    ],
    faq: [
      ["How do I add a user who signs in with our provider (Okta, Google, Microsoft)?", "Add them in Management Tools › Users / Employees with the same email they use with your provider, and choose your provider under <strong>How they sign in</strong>. New staff start on your provider while single sign-on is on."],
      ["Does single sign-on create accounts?", "No. Add people in Managira first (Users / Employees, or Admissions for students), with the same email they use with your provider."],
      ["Does it work for Mira?", "Yes. Mira signs in through Managira's own page, so single sign-on applies there too."],
      ["Why does the test fail?", "Most often the provider sends a different email than the one in Managira, or the email isn't sent at all. For SAML, send the email as the NameID or in an attribute named email, and sign the assertion or the response. For OpenID Connect, check the issuer, client ID and secret."],
      ["Can we use two providers?", "One connection per school, either SAML or OpenID Connect. Choose the provider most of your people use; anyone else can keep using a password."],
      ["What do new staff get by email?", "Someone added to sign in with your provider gets an invitation that says to log in with it, with no password to set. Someone added with a Managira password gets a link to set it."],
      ["Someone on our provider pressed Forgot password. What happens?", "No reset email is sent: the sign-in page tells them to continue with your provider instead."],
      ["Who sees the Single sign-on card?", "Only managers, whatever permissions anyone else holds."],
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
          ["Choose the provider and protocol, and copy the addresses", "A Managira manager", "Settings › Tenant configuration › Single sign-on › <strong>Copy all</strong>"],
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
          "The manager saves your details and selects <strong>Test</strong>, then signs in on the new tab with a test account that exists in Managira. Nothing changes for anyone until the test passes.",
          "The manager selects <strong>Turn on</strong> and confirms with their password. Turning it on moves nobody.",
          "Move two or three people first (Edit user › How they sign in) and check they can sign in from the login page and from your app launcher.",
          "Then move everyone with <strong>Use your provider for everyone</strong>, and send staff the short note: enter your email on the Managira login page and choose Continue.",
        ],
        note: "Students sign in through the provider only if the manager checks <strong>Students too</strong>.",
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
    summary: "Choose how long people stay signed in, Keep me logged in, the emailed code, remembered browsers, and who must use an authenticator app.",
    tags: ["tenant configuration", "session timeout", "keep me logged in", "verification code", "trusted devices", "remember device", "security settings", "two-step sign-in", "require authenticator", "mfa policy"],
    who: "Managers only.",
    intro: "Tenant configuration sets the sign-in rules for everyone at your school. The defaults suit most schools. Change them to match your district's security policy.",
    sections: [
      {
        title: "Open it",
        steps: [
          ["Open the <strong>☰</strong> menu, select <strong>Settings</strong>, then <strong>Tenant configuration</strong>."],
          ["The page has three cards: <strong>Session</strong>, <strong>Two-step sign-in</strong> and <strong>Single sign-on</strong>.", "account-settings-tenant.webp", "Settings › Tenant configuration."],
        ],
      },
      {
        title: "Session: how people stay signed in",
        steps: [
          "Change a setting below. <strong>Save</strong> turns on.",
          "Select <strong>Save</strong>. The rules apply from each person's next sign-in.",
        ],
        table: [
          ["Setting", "What it does", "Default"],
          ["<strong>Session timeout</strong>", "Signs people out after this long, even if they're active: 8, 12, 24 or 72 hours, or 7 days.", "24 hours"],
          ["<strong>Allow Keep me logged in</strong>", "Shows the Keep me logged in box at sign-in.", "On"],
          ["<strong>Keep me logged in for</strong>", "How long a checked Keep me logged in lasts: 7, 14, 30, 60 or 90 days.", "30 days"],
          ["<strong>Email a code at sign-in</strong>", "Asks for a code sent by email after the password, on a browser that isn't remembered.", "On"],
          ["<strong>Allow device to be remembered</strong>", "After a right code, skips the code on that browser for a while.", "On"],
          ["<strong>Trust duration</strong>", "How long a browser stays remembered, counted from the code: 1, 3, 7, 14 or 30 days.", "3 days"],
        ],
        note: "If the settings can't be read for a moment, nobody is signed out because of it.",
      },
      {
        title: "Two-step sign-in",
        image: "account-tenant-two-step-zoom.webp",
        caption: "Authenticator app at sign-in.",
        text: "Under <strong>Authenticator app at sign-in</strong>, choose <strong>Each person chooses</strong>, or require it for managers and supervisors (and your school's own account), or for all staff. The card also lists everyone who uses an app, each with a <strong>Reset</strong> button for when someone loses their phone. See " + link("two-step-sign-in", "Two-step sign-in with an authenticator app") + ".",
      },
      {
        title: "Single sign-on",
        text: "The last card sets up sign-in through your school's provider. See " + link("single-sign-on", "Set up single sign-on") + ".",
      },
    ],
    faq: [
      ["Does this affect single sign-on?", "Single sign-on skips the emailed code and the authenticator app, because your provider has already checked the person with its own two-step sign-in. The session timeout still applies."],
      ["Do the rules apply to parents and students?", "The session and code rules do. The authenticator app is for staff and your school's own account; parents and students keep the emailed code."],
      ["Can we turn the emailed code off but keep the authenticator app?", "Yes. Turning off <strong>Email a code at sign-in</strong> never turns off the app: anyone who uses one is still asked for its code."],
      ["What happens at the session limit?", "The person's open page goes to the sign-in page with \"Your sign-in has expired\", and they come back to the page after signing in."],
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
    who: "Managers, the school's own account and staff with Settings access set it up for themselves. Anyone the school requires it for is taken there when they sign in.",
    intro: "With two-step sign-in, signing in with your password also asks for a 6-digit code from an authenticator app on your phone. Someone who learns your password still can't open your account without your phone.",
    sections: [
      {
        title: "Turn it on for yourself",
        steps: [
          "Install an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator, 1Password or Authy.",
          ["In Managira, open the <strong>?</strong> menu and select <strong>Two-step sign-in</strong>, or go to <strong>Settings › Two-step sign-in</strong>."],
          ["Select <strong>Set up</strong>.", "account-settings-two-step.webp", "Authenticator app: Off, with a Set up button."],
          ["In your app, add an account (usually the <strong>+</strong> button) and scan the QR code. If you can't scan it, type the key shown under <strong>Key, if you can't scan</strong>."],
          "Type the 6-digit code your app shows in the box and select <strong>Turn on</strong>.",
          "Save your 10 <strong>recovery codes</strong>: print them or keep them in a password manager. They're shown only once.",
        ],
      },
      {
        title: "Sign in with the app",
        list: [
          "Enter your email and password as usual. Managira then asks for <strong>Enter your authenticator code</strong> instead of emailing one.",
          "The app shows a new code every 30 seconds. Type the newest one; each code works once.",
          "If your school lets browsers be remembered, a right code also remembers that browser for the school's trust period (3 days unless it chose otherwise).",
          "After 5 wrong codes, wait 10 minutes, then sign in again.",
        ],
        tip: "If a right code is refused, check that your phone sets its time automatically. Codes depend on the clock.",
      },
      {
        title: "Lost or replaced your phone",
        list: [
          "Type one of your recovery codes where the app's code goes (they look like <code>ab12c-34de5</code>). Each works once, and Managira tells you how many are left.",
          "Then open <strong>Settings › Two-step sign-in</strong>: turn it off and set it up on your new phone, or ask a manager to reset it.",
          "No recovery codes left? Ask a manager at your school to reset your app (below). You set it up again the next time you sign in.",
        ],
      },
      {
        title: "Turn it off",
        text: "Open <strong>Settings › Two-step sign-in</strong>, type your password and select <strong>Turn off</strong>. If your school requires the app for you, it can't be turned off; a manager can reset it so you can move it to a new phone.",
      },
      {
        title: "Require it at your school (managers)",
        steps: [
          ["Open <strong>Settings › Tenant configuration</strong> and find <strong>Two-step sign-in</strong>."],
          "Under <strong>Authenticator app at sign-in</strong>, choose <strong>Each person chooses</strong> (the default), <strong>Managers and supervisors</strong> (your school's own account too), or <strong>All staff</strong>, and select <strong>Save</strong>.",
          "Anyone required to use it who hasn't set it up is taken to <strong>Settings › Two-step sign-in</strong> the next time they open Managira, and can't open other pages until it's on. This works for every member of staff, even without Settings access.",
        ],
        note: "Changes are recorded in your school's activity log.",
      },
      {
        title: "Require it for one person (managers)",
        steps: [
          "In <strong>Management Tools</strong>, open <strong>Users / Employees</strong> and choose <strong>Edit</strong> beside the person.",
          "Check <strong>Require authenticator app</strong>, confirm the access, and select <strong>Save</strong>.",
        ],
        note: "Uncheck it to go back to your school's rule for them. Only managers see this choice.",
      },
      {
        title: "Reset someone's app (managers)",
        steps: [
          "In <strong>Settings › Tenant configuration</strong>, the <strong>Two-step sign-in</strong> card lists everyone at your school who uses an authenticator app.",
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
      ["Why don't I see Two-step sign-in in my ? menu?", "It's for managers, the school's own account and people with Settings access. Anyone the school requires it for is taken to it automatically."],
    ],
    related: ["sign-in-to-managira", "tenant-configuration", "authenticator-codes", "reset-a-password-or-recover-account-access"],
  },
  {
    slug: "profile-and-appearance",
    title: "Your profile, appearance and account details",
    topic: "Account & sign-in",
    order: 5,
    summary: "Change your photo and name, choose Light, Classic or Dark, update your email or password, and add an About me for families.",
    tags: ["profile", "appearance", "dark mode", "photo", "change email", "about me", "settings", "light classic dark", "fun fact"],
    who: "Everyone. Parents, students and drivers have a Settings page in their own portal.",
    intro: "Settings is where you change how Managira looks for you and keep your own details up to date.",
    sections: [
      {
        title: "Your photo and name",
        steps: [
          ["Open the <strong>☰</strong> menu, select <strong>Settings</strong>, then <strong>Profile</strong>.", "account-settings-profile.webp", "Settings › Profile: Appearance first, then Your details."],
          ["Under <strong>Your details</strong>, select <strong>Change photo</strong> to choose a picture. <strong>Remove</strong> appears once you have one."],
          "Edit <strong>First name</strong> and <strong>Last name</strong> and select <strong>Save changes</strong>.",
        ],
        note: "Your role is shown under your photo. Only a manager changes it.",
      },
      {
        title: "Light, Classic or Dark",
        steps: [
          ["At the top of <strong>Profile</strong>, choose <strong>Appearance</strong>: <strong>Light</strong> (clean white), <strong>Classic</strong> (warm and calm) or <strong>Dark</strong> (easy at night)."],
        ],
        text: "Only you see your choice, and it follows you on every device. Prints, PDFs and emails stay as designed. Parents and students choose theirs in <strong>Settings</strong> in their portal.",
      },
      {
        title: "Your email and password",
        steps: [
          ["Open <strong>Settings › Security</strong>.", "account-settings-security.webp", "Email and Change Password."],
          "Select <strong>Expand</strong> beside <strong>Email</strong>, type the new address and select <strong>Update Email</strong>, or expand <strong>Change Password</strong> and select <strong>Update Password</strong>. See " + link("reset-a-password-or-recover-account-access", "Reset your password") + ".",
        ],
        note: "Only the school's own account changes the school's sign-in email and password. Every member of staff, managers included, changes only their own. If your school uses single sign-on, ask a manager before changing your email.",
      },
      {
        title: "The account page and About me",
        text: "Staff also have an <strong>Update Account Information</strong> page (<code>managira.com/account/update</code>) with <strong>First Name</strong>, <strong>Last Name</strong>, <strong>Email</strong> (leave blank to keep the current one), <strong>New Password (optional)</strong> and <strong>Confirm New Password</strong>, then <strong>Update</strong>. Below it is <strong>About me</strong>.",
        image: "account-update-page.webp",
        caption: "The account page. About me sits under the form.",
        list: [
          "Type <strong>Something fun about you</strong> (up to 280 characters) and add up to two photos, then select <strong>Save</strong>.",
          "Families see it on their child's Teachers page, when your school shares it. Photos are re-saved without any location information.",
          "Only you change your own About me.",
        ],
      },
      {
        title: "Parents, students and drivers",
        images: [],
        list: [
          "<strong>Parents:</strong> Appearance, Profile (your photo, your children's photos and your details) and Notifications.",
          "<strong>Students:</strong> Appearance and Notifications.",
          "<strong>Drivers:</strong> Appearance and Your details (photo, email, phone).",
          "Which alerts and emails you get, and how, is one list under <strong>Notifications</strong>. See " + link("notifications-and-alerts", "Your notifications and alerts") + ".",
        ],
      },
    ],
    faq: [
      ["Why can't I change my email?", "Your school may manage emails centrally, or use single sign-on. Ask a manager."],
      ["Where do I choose which emails I get?", "In <strong>Settings › Notifications</strong>. See " + link("notifications-and-alerts", "Your notifications and alerts") + "."],
      ["Does Dark appearance change what parents see?", "No. Appearance is yours alone. Prints, PDFs and emails don't change."],
    ],
    related: ["sign-in-to-managira", "email-notifications-reference", "notifications-and-alerts", "two-step-sign-in"],
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
        note: "It's the same app as " + link("two-step-sign-in", "two-step sign-in") + ". If you already set that up, you don't set up another.",
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
