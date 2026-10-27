// A redirect target taken from a form or link is used only when it stays on this
// site ("/account/settings", not "https://elsewhere" or "//elsewhere"), so a
// crafted form can't send a signed-in person on to another website.
function localPath(value, fallback) {
  const path = typeof value === "string" ? value.trim() : "";
  return /^\/(?![/\\])/.test(path) && !/[\r\n]/.test(path) ? path : fallback;
}

module.exports = { localPath };
