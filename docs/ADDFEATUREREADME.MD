# 🧩 ADDING A NEW FEATURE AND HOW IT WORKS FOR THE PLAN SELECTION

### **1️⃣ Register the Feature**
Navigate to `scripts/setupFeatures.js` and add a new feature like this:
✅ Replace `'New Feature Name'` with your desired feature name.  
✅ Replace `'/routePath'` with the route you want to protect.

```bash
const { registerFeature } = require('../utils/featureRegistrar');

(async () => {
  await registerFeature('New Feature Name', '/routePath');
  consle.log('✅ Features registered successfully.');
  process.exit(0); // Exit after registration
})();
```

In your terminal, run:

```bash
node scripts/setupFeatures.js
```
✅ This will add the feature to the database and link it to the specified route.

---

### **2️⃣ Protect the Route**
In your route file (e.g., `routes/exampleRoute.js`), import the middleware and add it to the route:

```bash
const checkFeatureAccess = require('../middleware/checkFeatureAccess');

router.get('/routePath', checkFeatureAccess, (req, res) => {
  res.render('yourViewFile', { title: 'Page Title' });
});
```
✅ Only users with the feature enabled in their plan will access this route.

---

### **3️⃣ Assign the Feature to a Plan**
Go to the **Service Pricing** page in the admin panel:  
- Select the feature from the dropdown.  
- Assign it to the desired plan.  
- Set the price (if applicable).  
✅ Plans without the assigned feature will not grant users access to the route.

---

### **4️⃣ Hide/Show Buttons & Links in the Frontend Based on the Plan**
To ensure that **buttons or links do not appear** when the feature is not available in the plan, we dynamically control visibility using `allowedFeatures`.

#### **🔹 Example 1: Hide/Show a Button**
To **hide or show a button**, modify the relevant EJS file (e.g., `orgDashboard.ejs`):

```bash
<div class="dashboard-buttons">
  <button id="orgDashboardBtn" class="active">Org Dashboard</button>

  <% if (allowedFeatures.includes('Public dashboard feature')) { %>
    <button id="publicDashboardBtn" onclick="window.location.href='/common/publicDashboard'">
      Public Dashboard
    </button>
  <% } %>
</div>
```
✅ The "Public Dashboard" button will **only** appear if the user’s plan includes the **Public dashboard feature**.

---
#### **🔹 Example 2: Hide/Show a Link in the Header**
To **conditionally show a link in the navigation header**, modify the header file (e.g., `header.ejs`):

```bash
<li class="nav-item">
  <a href="#" class="submenu-toggle reports" data-target="reports-submenu">
    Reports <span class="arrow">&#9660;</span>
  </a>
  <ul class="management-links submenu" id="reports-submenu">
    <li><a href="/common/management">📑 Term Management</a></li>

    <% if (allowedFeatures.includes("Statistics")) { %>
      <li><a href="/stats/organization">📊 Organization Stats</a></li>
    <% } %>
  </ul>
</li>
```
✅ The **Statistics** link will **only** be visible if the user’s plan includes **Statistics**.

### **5️⃣ How the Process Works**
1. **Feature Registration:**  
   - Adds the feature to the `features` table.  
   - Links it to a route via the `feature_routes` table.

2. **Access Control Middleware (`checkFeatureAccess.js`)**  
   - Checks if the logged-in user’s organization plan includes the feature.  
   - Blocks access with a **redirect to orgDashboard** if not included.

3. **Frontend Handling (`setAllowedFeatures.js`)**  
   - Passes `allowedFeatures` to **all views** using session variables.  
   - Dynamically shows/hides **links, buttons, and UI elements**.

4. **Assigning Features to Plans:**  
   - Managed through the admin’s **Service Pricing** page.  
   - Easily attach features to any **subscription plan**.

5. **Price Management:**  
   - Prices are set via the admin panel.  
   - Stored in the `features` table’s `price_usd` column.

---
## ✅ **Example Feature Flow (Statistics Feature)**
1️⃣ **Register the Feature** in `scripts/setupFeatures.js`:
```bash
await registerFeature('Statistics', '/stats/organization');
```
2️⃣ **Run the setup script**:
```bash
node scripts/setupFeatures.js
```
3️⃣ **Protect the Route** in `routes/statsRoutes.js`:
```bash
router.get('/organization', checkFeatureAccess, statsController.getOrganizationStats);
```
4️⃣ **Assign "Statistics" to a Plan** via the admin panel.
5️⃣ **Update the frontend to conditionally show/hide Statistics:**
```bash
<% if (allowedFeatures.includes('Statistics')) { %>
  <a href="/stats/organization">Statistics</a>
<% } %>
```