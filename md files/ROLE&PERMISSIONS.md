# README: Using Express Session in EJS Templates

## Overview

This guide explains how to make `req` available in all EJS templates in an Express application without manually passing it in every `res.render()` call.

## Steps to Implement

### 1. Install Required Dependencies

Ensure you have Express and Express-Session installed:

```sh
npm install express express-session
```

### 2. Set Up Express and Middleware

Modify your `server.js` or `app.js` file to include session management and make `req` available globally in EJS views.

```javascript
const express = require("express");
const session = require("express-session");

const app = express();

// Set up EJS as the view engine
app.set("view engine", "ejs");

// Configure Express-Session
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
  })
);

// Middleware to make `req` available globally in all EJS templates
app.use((req, res, next) => {
  res.locals.req = req;
  next();
});

// Example route
app.get("/publicDashboard", (req, res) => {
  res.render("publicDashboard"); // No need to manually pass req
});

app.listen(3000, () => {
  consle.log("Server running on port 3000");
});
```

### 3. Using `req` in EJS Templates

Now, in any EJS file (e.g., `views/publicDashboard.ejs`), you can access `req` directly:

```ejs
<% if (req.session && req.session.accountType === 'MANAGER') { %>
  <a class="edit-public-dashboard" href="/account/managePublicContent">
    <button>Edit Public Dashboard</button>
  </a>
<% } %>
```

### 4. Benefits of This Approach

- No need to manually pass `req` in every `res.render()` call.
- Cleaner and more maintainable code.
- Ensures `req` is always available in all views.

### 5. Troubleshooting

- **`req` is still undefined?** Ensure the middleware is added **before** defining your routes.
- **Session not persisting?** Check that `express-session` is configured correctly and that cookies are enabled in the browser.

---

Now, `req` will be accessible globally in all EJS templates, making your Express app easier to maintain! 🚀



✅ Allow Only Teachers
```bash
<% if (req.session && req.session.userRole === 'Teacher') { %>
    <!-- Code Visible Only to Teachers -->
<% } %>
```

✅ Allow Only Managers
```bash
<% if (req.session && req.session.userRole === 'Manager') { %>
    <!-- Code Visible Only to Managers -->
<% } %>
```

✅ Allow Only Supervisors
```bash
<% if (req.session && req.session.userRole === 'Supervisor') { %>
    <!-- Code Visible Only to Supervisors -->
<% } %>
```

✅ Allow Both Managers and Supervisors
```bash
<% if (req.session && (req.session.userRole === 'Manager' || req.session.userRole === 'Supervisor')) { %>
    <!-- Code Visible to Both Managers and Supervisors -->
<% } %>
```

✅ Allow Supervisors & Teachers, But Not Managers
```bash
<% if (req.session && req.session.userRole !== 'Manager') { %>
    <!-- Code Visible to Everyone Except Managers (i.e., Supervisors & Teachers) -->
<% } %>
```

✅ Allow Everyone Except Teachers & Supervisors
```bash
<% if (req.session && req.session.userRole !== 'Teacher' && req.session.userRole !== 'Supervisor') { %>
    <!-- Code Visible to All Except Teachers and Supervisors -->
<% } %>
```

✅ Allow Everyone Except Managers & Admins
```bash
<% if (req.session && req.session.userRole !== 'Manager' && req.session.userRole !== 'Admin') { %>
    <!-- Code Visible to All Except Managers and Admins -->
<% } %>
```

✅ Allow Only Admins
```bash
<% if (req.session && req.session.userRole === 'Admin') { %>
    <!-- Code Visible Only to Admins -->
<% } %>
```

✅ Allow Only Teachers & Admins
```bash
<% if (req.session && (req.session.userRole === 'Teacher' || req.session.userRole === 'Admin')) { %>
    <!-- Code Visible Only to Teachers & Admins -->
<% } %>
```

✅ Allow Only Teachers & Managers
```bash
<% if (req.session && (req.session.userRole === 'Teacher' || req.session.userRole === 'Manager')) { %>
    <!-- Code Visible Only to Teachers & Managers -->
<% } %>
```

✅ Allow Only Supervisors & Admins
```bash
<% if (req.session && (req.session.userRole === 'Supervisor' || req.session.userRole === 'Admin')) { %>
    <!-- Code Visible Only to Supervisors & Admins -->
<% } %>
```

✅ Allow Everyone Except Teachers
```bash
<% if (req.session && req.session.userRole !== 'Teacher') { %>
    <!-- Code Visible to Everyone Except Teachers -->
<% } %>
```

✅ Allow Everyone Except Supervisors
```bash
<% if (req.session && req.session.userRole !== 'Supervisor') { %>
    <!-- Code Visible to Everyone Except Supervisors -->
<% } %>
```

✅ Allow Everyone
```bash
<% if (req.session) { %>
    <!-- Code Visible to Everyone -->
<% } %>
```


finally add checkfeatureaccess to the route to prevent other users from accessing the route manually.
```bash
router.get("/managePublicContent", checkFeatureAccess, isAuthenticated, (req, res) => accountController.managePublicContentGet(req, res, db));
```


