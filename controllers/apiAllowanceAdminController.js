// Admin -> API requests: schools asking for a bigger Managira API allowance.
// Grant (with a monthly price that goes on the school's bill) or decline.
const allowance = require("../utils/apiAllowance");

const PAGE = "/admin/api-requests";
const panelOnly = (req, res) => {
  if (res.locals.drawer) return true;
  res.redirect(`${PAGE}?drawer=${encodeURIComponent(req.originalUrl.split("?")[0])}`);
  return false;
};
const findRequest = async (id) => (await allowance.adminListRequests()).find((r) => r.request_id === Number(id));

module.exports = {
  page: async (req, res) => {
    try {
      const [requests, allowances] = await Promise.all([allowance.adminListRequests(), allowance.adminListAllowances()]);
      res.render("admin/apiRequests", {
        title: "API requests",
        requests,
        allowances,
        standard: allowance.DEFAULT_ALLOWANCE,
        messages: req.flash(),
        showFooterTopSection: false,
      });
    } catch (error) {
      console.error("[admin api-requests]", error.message);
      req.flash("error", "Could not load API requests.");
      res.redirect("/admin");
    }
  },

  count: async (req, res) => {
    try {
      res.json({ pending: await allowance.adminPendingCount() });
    } catch (_e) {
      res.json({ pending: 0 });
    }
  },

  grantForm: async (req, res) => {
    if (!panelOnly(req, res)) return;
    const request = await findRequest(req.params.id);
    if (!request || request.status !== "pending") return res.status(404).send('<p class="ahd-missing">This request was already answered.</p>');
    res.render("admin/forms/apiGrant", { request });
  },

  declineForm: async (req, res) => {
    if (!panelOnly(req, res)) return;
    const request = await findRequest(req.params.id);
    if (!request || request.status !== "pending") return res.status(404).send('<p class="ahd-missing">This request was already answered.</p>');
    res.render("admin/forms/apiDecline", { request });
  },

  grant: async (req, res) => {
    try {
      await allowance.adminGrant(req, Number(req.params.id), req.body || {});
      req.flash("success", "Allowance raised. The monthly price is on the school's next bill, and they've been emailed.");
    } catch (error) {
      if (!error.status) console.error("[admin api grant]", error.message);
      req.flash("error", error.status ? error.message : "Could not grant the request.");
    }
    res.redirect(PAGE);
  },

  decline: async (req, res) => {
    try {
      await allowance.adminDecline(req, Number(req.params.id), req.body || {});
      req.flash("success", "Request declined. The school has been told.");
    } catch (error) {
      if (!error.status) console.error("[admin api decline]", error.message);
      req.flash("error", error.status ? error.message : "Could not decline the request.");
    }
    res.redirect(PAGE);
  },

  reset: async (req, res) => {
    try {
      await allowance.adminReset(Number(req.params.orgId), req);
      req.flash("success", "Back to the standard allowance. The monthly API charge stopped.");
    } catch (error) {
      console.error("[admin api reset]", error.message);
      req.flash("error", "Could not reset the allowance.");
    }
    res.redirect(PAGE);
  },
};
